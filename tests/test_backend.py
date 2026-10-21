"""Offline tests: deterministic tools, actual HTTP boundaries and mock model JSON."""
import csv
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from opspilot.config import ROOT, Settings, load_dotenv
from opspilot.model import validate_insights
from opspilot.service import analyze_request, usage_metrics
from server import Handler

VALID = {"hypotheses": [{"hypothesis": "渠道活动可能发生变化，需验证。", "validation": "核对活动日志与转化数据。", "evidence_ids": ["K03"]}]}


class ModelMock(BaseHTTPRequestHandler):
    calls = []
    content = VALID

    def log_message(self, *_):
        pass

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.__class__.calls.append(data)
        body = json.dumps({"choices": [{"message": {"content": json.dumps(self.content, ensure_ascii=False)}}],
                           "usage": {"prompt_tokens": 100, "completion_tokens": 40}}).encode()
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body)


class BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with (ROOT / "dist/sample.csv").open(encoding="utf-8-sig") as source:
            cls.rows = list(csv.DictReader(source))
        cls.mock = HTTPServer(("127.0.0.1", 0), ModelMock)
        cls.mock_thread = threading.Thread(target=cls.mock.serve_forever, daemon=True)
        cls.mock_thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.mock.shutdown(); cls.mock.server_close(); cls.mock_thread.join()

    def setUp(self):
        ModelMock.calls = []
        ModelMock.content = VALID
        self.payload = {"question": "最近7天GMV为什么下降", "rows": self.rows}
        self.settings = Settings(api_key="test-only", model="mock", base_url=f"http://127.0.0.1:{self.mock.server_port}")

    def test_disabled_ai_preserves_actual_calculation(self):
        result = analyze_request(self.payload, Settings())
        self.assertAlmostEqual(result["current"], 717079.28)
        self.assertEqual(result["ai_status"], "disabled")
        self.assertIsNone(result["usage"])

    def test_one_actual_http_call_and_structured_hypotheses(self):
        result = analyze_request(self.payload, self.settings)
        self.assertEqual(len(ModelMock.calls), 1)
        self.assertTrue(result["ai"])
        self.assertEqual(result["usage"]["prompt_tokens"], 100)
        self.assertIsNone(result["cost_usd"])
        sent = json.loads(ModelMock.calls[0]["messages"][1]["content"])
        self.assertNotIn("rows", sent)

    def test_unknown_reference_falls_back_without_losing_results(self):
        ModelMock.content = {"hypotheses": [{**VALID["hypotheses"][0], "evidence_ids": ["K999"]}]}
        result = analyze_request(self.payload, self.settings)
        self.assertEqual(result["ai_status"], "fallback")
        self.assertAlmostEqual(result["current"], 717079.28)
        self.assertEqual(result["usage"]["completion_tokens"], 40)

    def test_invented_metrics_are_not_accepted_as_output(self):
        ModelMock.content = {**VALID, "revenue": 999}
        self.assertEqual(analyze_request(self.payload, self.settings)["ai_status"], "fallback")

    def test_bad_json_falls_back(self):
        result = analyze_request(self.payload, self.settings, client=lambda *_: ("bad json", None))
        self.assertEqual(result["ai_status"], "fallback")
        self.assertIsNone(result["usage"])

    def test_model_timeout_falls_back(self):
        def timeout(*_):
            raise TimeoutError()
        self.assertEqual(analyze_request(self.payload, self.settings, client=timeout)["ai_status"], "fallback")

    def test_refused_query_never_calls_model(self):
        result = analyze_request({**self.payload, "question": "预测明天GMV"}, self.settings)
        self.assertFalse(result["ok"])
        self.assertEqual(len(ModelMock.calls), 0)

    def test_definition_does_not_need_model(self):
        self.assertTrue(analyze_request({**self.payload, "question": "ROAS是什么"}, self.settings)["ok"])
        self.assertEqual(len(ModelMock.calls), 0)

    def test_channel_scope_is_shared_with_tool(self):
        result = analyze_request({**self.payload, "channel": "抖音"}, Settings())
        self.assertAlmostEqual(result["current"], 106182.72)

    def test_cost_only_when_actual_usage_and_both_prices_exist(self):
        settings = replace(self.settings, input_price=1, output_price=2)
        metrics = usage_metrics({"prompt_tokens": 100, "completion_tokens": 40}, settings)
        self.assertAlmostEqual(metrics["cost_usd"], 0.00018)

    def test_unknown_usage_is_not_zero(self):
        self.assertIsNone(usage_metrics({}, self.settings)["usage"])

    def test_boolean_token_count_is_invalid(self):
        self.assertIsNone(usage_metrics({"prompt_tokens": True, "completion_tokens": 1}, self.settings)["usage"])

    def test_plain_http_external_endpoint_rejected(self):
        with self.assertRaises(ValueError): Settings.from_env({"OPSPILOT_BASE_URL": "http://example.com/v1"})

    def test_endpoint_with_embedded_credentials_rejected(self):
        with self.assertRaises(ValueError): Settings.from_env({"OPSPILOT_BASE_URL": "https://user:pass@example.com/v1"})

    def test_invalid_price_fails_configuration_clearly(self):
        with self.assertRaises(ValueError): Settings.from_env({"OPSPILOT_INPUT_USD_PER_MILLION": "NaN"})

    def test_timeout_limit(self):
        with self.assertRaises(ValueError): Settings.from_env({"OPSPILOT_TIMEOUT_SECONDS": "90"})

    def test_dotenv_does_not_override_process_settings(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict("os.environ", {"OPSPILOT_MODEL": "existing"}):
            path = Path(folder) / ".env"; path.write_text('OPSPILOT_MODEL="new"\n')
            load_dotenv(path)
            import os
            self.assertEqual(os.environ["OPSPILOT_MODEL"], "existing")

    def test_empty_hypotheses_are_a_valid_abstention(self):
        self.assertEqual(validate_insights('{"hypotheses": []}', []), [])

    def test_missing_references_are_rejected(self):
        with self.assertRaises(ValueError): validate_insights(json.dumps(VALID), [])


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.handler = type("TestHandler", (Handler,), {"settings": Settings()})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), cls.handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()

    def request(self, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as error:
            return error.code, error.read(), error.headers

    def test_health(self):
        status, body, _ = self.request('/api/health')
        self.assertEqual(status, 200); self.assertTrue(json.loads(body)['ok'])

    def test_static_frontend(self):
        status, body, _ = self.request('/')
        self.assertEqual(status, 200); self.assertIn(b'OpsPilot', body)

    def test_env_is_not_a_public_asset(self):
        self.assertEqual(self.request('/.env')[0], 404)

    def test_config_never_contains_api_key(self):
        body = json.loads(self.request('/api/config')[1])
        self.assertNotIn('api_key', body); self.assertFalse(body['ai'])

    def test_cross_origin_is_rejected(self):
        status, _, _ = self.request('/api/analyze', {}, {'Origin': 'https://other.example', 'Content-Type': 'application/json'})
        self.assertEqual(status, 403)

    def test_non_json_rejected(self):
        self.assertEqual(self.request('/api/analyze', {}, {'Content-Type': 'text/plain'})[0], 415)

    def test_bad_payload_rejected(self):
        self.assertEqual(self.request('/api/analyze', [], {'Content-Type': 'application/json'})[0], 400)

    def test_directory_listing_disabled(self):
        self.assertEqual(self.request('/lib/')[0], 404)


if __name__ == '__main__':
    unittest.main()
