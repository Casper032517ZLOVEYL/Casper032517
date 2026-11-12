import base64
import copy
import io
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from finpilot.agent import ModelClient, run_agent
from finpilot.data import parse_csv, parse_document, validate_dataset
from finpilot.engine import Toolbox, calculate, growth, search, workflow
from finpilot.service import analyze, diff_snapshot, ingest, sample, snapshot

HEADER = "company,period,currency,unit,revenue,net_income,operating_cash_flow\n"
DATA = HEADER + "Acme,FY2023,USD,million,100,10,20\nAcme,FY2024,USD,million,120,15,18\n"


def rows(text=DATA):
    return parse_csv(text.encode())


class ImportTests(unittest.TestCase):
    def test_valid_and_stable_evidence(self):
        self.assertEqual(rows()[0]["id"], rows()[0]["id"])
        self.assertNotEqual(rows()[0]["id"], rows()[1]["id"])

    def test_missing_is_not_zero(self):
        r = rows(HEADER + "X,FY2024,USD,one,0,,0\n")[0]
        self.assertIsNone(r["net_income"])
        self.assertEqual(r["revenue"], "0")

    def test_nan_infinity_and_bad_number(self):
        for value in ("NaN", "Infinity", "oops", "1e999"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                rows(HEADER + f"X,FY2024,USD,one,{value},1,1\n")

    def test_required_columns(self):
        with self.assertRaises(ValueError):
            rows("company,revenue\nX,3\n")

    def test_duplicate_and_mixed_basis(self):
        for extra in ("Acme,FY2024,USD,million,120,15,18\n", "Acme,FY2025,EUR,million,120,15,18\n"):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                rows(DATA + extra)

    def test_empty_negative_and_bad_period(self):
        for line in ("X,FY2024,USD,one,,,", "X,FY2024,USD,one,-1,1,1", "X,2024YTD,USD,one,1,1,1"):
            with self.subTest(line=line), self.assertRaises(ValueError):
                rows(HEADER + line + "\n")

    def test_cross_file_conflict(self):
        with self.assertRaises(ValueError):
            validate_dataset(rows() + rows())

    def test_source_scheme_filter(self):
        data = DATA.replace("operating_cash_flow\n", "operating_cash_flow,source\n").replace("100,10,20\n", "100,10,20,javascript:alert(1)\n").replace("120,15,18\n", "120,15,18,https://example.com/report\n")
        self.assertEqual(rows(data)[0]["source"], "")
        self.assertEqual(rows(data)[1]["source"], "https://example.com/report")

    def test_bad_upload_and_text(self):
        with self.assertRaises(ValueError):
            ingest([{"name": "bad.csv", "base64": "???"}])
        with self.assertRaises(ValueError):
            parse_document(b"hello", "doc.exe")
        chunks = parse_document(("operating cash flow declined. "*100).encode(), "report.txt")
        self.assertGreater(len(chunks), 1)
        self.assertEqual(chunks[0]["page"], 1)

    def test_utf8_and_byte_limit(self):
        with self.assertRaises(ValueError):
            parse_csv(b"\xff\xff")
        with self.assertRaises(ValueError):
            parse_csv(b"x" * (5 * 1024 * 1024 + 1))

    def test_pdf_extract_and_scanned_rejection(self):
        try:
            from pypdf import PdfWriter
            from pypdf.generic import DictionaryObject, NameObject, NumberObject, DecodedStreamObject
        except ImportError:
            self.skipTest("optional pypdf is not installed")
        writer = PdfWriter()
        page = writer.add_blank_page(width=612, height=792)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(b'BT /F1 12 Tf 40 700 Td (Operating cash flow declined during the year.) Tj ET')
        page[NameObject('/Contents')] = writer._add_object(stream)
        raw = io.BytesIO();writer.write(raw)
        chunks = parse_document(raw.getvalue(), 'report.pdf')
        self.assertIn('Operating cash flow', chunks[0]['text'])
        blank = PdfWriter();blank.add_blank_page(width=100, height=100)
        buf = io.BytesIO();blank.write(buf)
        with self.assertRaises(ValueError):
            parse_document(buf.getvalue(), 'scan.pdf')


class EngineTests(unittest.TestCase):
    def test_known_financial_answers(self):
        r = calculate(rows(), "Acme")[-1]
        self.assertEqual(r["yoy_pct"], {"revenue": 20, "net_income": 50, "operating_cash_flow": -10})
        self.assertEqual(r["net_margin_pct"], 12.5)
        self.assertEqual(len(r["evidence_ids"]), 2)

    def test_no_positive_base_no_growth(self):
        self.assertIsNone(growth("3", "0"))
        self.assertIsNone(growth("3", "-2"))
        self.assertIsNone(growth(None, "2"))

    def test_quarters_do_not_compare_to_annual_or_previous_quarter(self):
        r = rows(HEADER + "X,FY2023,USD,one,100,10,20\nX,FY2024-Q1,USD,one,30,3,4\nX,FY2024-Q2,USD,one,40,4,5\n")
        result = calculate(r, "X")
        self.assertIsNone(result[-1]["yoy_pct"]["revenue"])

    def test_cash_divergence_triggers_followup_question(self):
        report = workflow(Toolbox(rows(), []), "分析Acme")
        self.assertTrue(any(f["kind"] == "hypothesis" for f in report["findings"]))
        self.assertEqual(report["mode"], "offline_workflow")

    def test_search_and_unseen_evidence(self):
        chunks = parse_document(("现金流下降，存货增加。"*30).encode(), "r.txt")
        self.assertTrue(search(chunks, "现金流"))
        self.assertEqual(search(chunks, "xyzabsent"), [])
        box = Toolbox(rows(), chunks)
        with self.assertRaises(ValueError):
            box.call("read_evidence", {"evidence_id": rows()[0]["id"]})
        with self.assertRaises(ValueError):
            box.call("shell", {"command": "echo no"})


class ScriptedClient:
    def __init__(self, actions):
        self.actions = iter(actions)
        self.calls = 0

    def __call__(self, messages):
        self.calls += 1
        return next(self.actions)


class AgentTests(unittest.TestCase):
    def test_adaptive_tool_loop_and_report(self):
        rr = rows(); ids = [r["id"] for r in rr]
        client = ScriptedClient([
            {"action": "tool", "tool": "list_companies", "arguments": {}},
            {"action": "tool", "tool": "calculate_metrics", "arguments": {"company": "Acme"}},
            {"action": "tool", "tool": "search_documents", "arguments": {"query": "inventory"}},
            {"action": "finish", "summary": "指标存在背离", "findings": [{"kind": "calculation", "text": "营收同比20%", "evidence_ids": ids}], "open_questions": ["需核实原因"]}])
        report = run_agent(Toolbox(rr, []), "分析现金流", client=client)
        self.assertEqual(report["status"], "completed")
        self.assertEqual(client.calls, 4)
        self.assertEqual(report["trace"][-1]["result"], [])

    def test_fabricated_citation_is_rejected(self):
        bad = {"action": "finish", "summary": "x", "findings": [{"kind": "fact", "text": "bad", "evidence_ids": ["E-fake"]}], "open_questions": []}
        r = run_agent(Toolbox(rows(), []), "x", client=ScriptedClient([bad]), max_steps=1)
        self.assertEqual(r["status"], "incomplete")
        self.assertEqual(r["findings"], [])

    def test_budget_and_unknown_tools(self):
        actions = [{"action": "tool", "tool": "execute_code", "arguments": {}}] * 3
        c = ScriptedClient(actions)
        r = run_agent(Toolbox(rows(), []), "x", client=c, max_steps=3)
        self.assertEqual(c.calls, 3)
        self.assertEqual(r["status"], "incomplete")
        self.assertTrue(all(t["status"] == "error" for t in r["trace"]))

    def test_elapsed_budget(self):
        c = ScriptedClient([])
        r = run_agent(Toolbox([], []), "x", client=c, max_seconds=0)
        self.assertEqual(c.calls, 0)
        self.assertEqual(r["status"], "incomplete")

    def test_model_failure_retains_calculations(self):
        class Failure:
            def __init__(self): self.calls = 0
            def __call__(self, messages):
                self.calls += 1
                if self.calls == 1:
                    return {"action":"tool", "tool":"calculate_metrics", "arguments":{"company":"Acme"}}
                raise ValueError("模拟超时")
        box = Toolbox(rows(), [])
        r = run_agent(box, "x", client=Failure())
        self.assertEqual(r["status"], "incomplete")
        self.assertIn("Acme", box.calculations)

    def test_consent_gate(self):
        with self.assertRaises(ValueError):
            analyze(sample(), "分析", "agent", False)

    def test_history_is_bounded_and_upload_resets_it(self):
        s = sample()
        for _ in range(6): analyze(s, "Apple")
        self.assertEqual(len(s["history"]), 4)
        new = ingest([{"name":"m.csv", "base64":base64.b64encode(DATA.encode()).decode()}])
        self.assertEqual(new["history"], [])

    def test_real_transport_contract_with_stub_response(self):
        env = {"FINPILOT_API_KEY":"test-secret", "FINPILOT_MODEL":"test-model", "FINPILOT_BASE_URL":"https://example.test/v1"}
        raw = {"choices":[{"message":{"content":'{"action":"tool","tool":"list_companies","arguments":{}}'}}], "usage":{"prompt_tokens":10,"completion_tokens":20}}
        class Response(io.BytesIO):
            pass
        class Opener:
            def open(self, req, timeout):
                payload = json.loads(req.data)
                assert payload["response_format"] == {"type":"json_object"}
                assert "test-secret" not in req.data.decode()
                assert timeout == 20
                return Response(json.dumps(raw).encode())
        with patch.dict(os.environ, env), patch("urllib.request.build_opener", return_value=Opener()):
            c = ModelClient()
            self.assertEqual(c([{"role":"user", "content":"json"}])["tool"], "list_companies")
            self.assertEqual(c.usage["prompt_tokens"], 10)


class TrackingTests(unittest.TestCase):
    def test_snapshot_changes_and_basis(self):
        s = sample(); old = snapshot(s)
        self.assertEqual(diff_snapshot(s, old)["changes"], [])
        old["rows"][1]["revenue"] = "1"
        change = diff_snapshot(s, old)["changes"]
        self.assertEqual(change[0]["type"], "changed_value")
        old["rows"][1]["currency"] = "EUR"
        self.assertEqual(diff_snapshot(s, old)["changes"][0]["type"], "incomparable_basis")

    def test_bad_snapshot_rejected(self):
        with self.assertRaises(ValueError):
            diff_snapshot(sample(), {"schema":"wrong", "rows":[]})

    def test_absent_record_not_a_deleted_filing(self):
        s = sample(); old = snapshot(s)
        s["rows"] = s["rows"][:1]
        self.assertEqual(diff_snapshot(s, old)["changes"][0]["type"], "not_in_current_upload")


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import server
        cls.server = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close()

    def request(self, path, body=None, cookie=None, origin=True, host=None):
        headers = {}
        if cookie: headers["Cookie"] = cookie
        if host: headers["Host"] = host
        if body is not None:
            headers["Content-Type"] = "application/json"
            if origin: headers["Origin"] = self.base
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            r = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            r = e
        return r.status, r.headers, r.read()

    def test_sample_to_analyze_and_isolation(self):
        code, headers, _ = self.request('/api/sample', {})
        self.assertEqual(code, 200)
        cookie = headers['Set-Cookie'].split(';')[0]
        code, _, body = self.request('/api/analyze', {"question":"Apple"}, cookie)
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["status"], "completed")
        code, _, body = self.request('/api/status')
        self.assertEqual(json.loads(body)["scope"]["rows"], 0)

    def test_bad_upload_preserves_previous_data(self):
        _, headers, _ = self.request('/api/sample', {})
        cookie = headers['Set-Cookie'].split(';')[0]
        code, _, _ = self.request('/api/upload', {"files":[{"name":"bad.csv", "base64":"?"}]}, cookie)
        self.assertEqual(code, 400)
        _, _, body = self.request('/api/status', cookie=cookie)
        self.assertEqual(json.loads(body)["scope"]["rows"], 2)

    def test_host_origin_and_private_paths(self):
        self.assertEqual(self.request('/api/status', host='evil.example')[0], 403)
        self.assertEqual(self.request('/api/sample', {}, origin=False)[0], 403)
        self.assertEqual(self.request('/.env')[0], 404)
        self.assertEqual(self.request('/../server.py')[0], 404)


if __name__ == '__main__':
    unittest.main()
