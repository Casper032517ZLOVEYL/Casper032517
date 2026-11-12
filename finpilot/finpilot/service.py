"""Service boundary shared by UI and tests."""
import base64
import binascii
import hashlib
import json
from pathlib import Path
from .agent import run_agent
from .data import parse_csv, parse_document, validate_dataset
from .engine import Toolbox, workflow

ROOT = Path(__file__).resolve().parents[1]


def ingest(files):
    if not isinstance(files, list) or not 1 <= len(files) <= 6:
        raise ValueError("每次请选择1至6个文件")
    rows, chunks, names, total = [], [], [], 0
    for f in files:
        if not isinstance(f, dict) or not isinstance(f.get("name"), str) or not isinstance(f.get("base64"), str):
            raise ValueError("上传格式无效")
        name = Path(f["name"]).name[:120]
        if name in names:
            raise ValueError("文件名不能重复")
        names.append(name)
        try:
            content = base64.b64decode(f["base64"], validate=True)
        except (ValueError, binascii.Error):
            raise ValueError("上传文件编码无效") from None
        total += len(content)
        if total > 10 * 1024 * 1024:
            raise ValueError("全部文件合计不得超过10MB")
        if name.lower().endswith(".csv"):
            rows.extend(parse_csv(content, name))
        else:
            chunks.extend(parse_document(content, name))
    validate_dataset(rows)
    if len(chunks) > 700:
        raise ValueError("文档总片段超过700，请减少文件")
    return {"rows": rows, "chunks": chunks, "files": names, "history": []}


def sample():
    raw = (ROOT / "examples/apple_fy2023_2024.csv").read_bytes()
    return {"rows": parse_csv(raw, "apple_fy2023_2024.csv"), "chunks": [],
            "files": ["Apple官方公开财务数据：FY2023/FY2024"], "history": []}


def overview(state):
    return {"files": state["files"], "companies": sorted({r["company"] for r in state["rows"]}),
            "rows": len(state["rows"]), "chunks": len(state["chunks"])}


def analyze(state, question, mode="offline", consent=False, client=None):
    if not isinstance(question, str) or not 1 <= len(question.strip()) <= 2000:
        raise ValueError("问题需为1至2000字符")
    if mode not in {"offline", "agent"}:
        raise ValueError("未知模式")
    if not state["rows"] and not state["chunks"]:
        raise ValueError("请先载入样例或上传文件")
    box = Toolbox(state["rows"], state["chunks"])
    if mode == "agent":
        if consent is not True:
            raise ValueError("启用模型前需确认将问题、历史摘要及检索到的数据发送到所配置服务商")
        report = run_agent(box, question, state["history"], client=client)
    else:
        report = workflow(box, question)
    report["question"] = question
    report["calculations"] = box.calculations
    report["evidence"] = list(box.exposed.values())
    report["data_fingerprint"] = hashlib.sha256(json.dumps(state["rows"], sort_keys=True).encode()).hexdigest()
    report["scope"] = overview(state)
    report["limitations"] = ["资料截至所上传文件，并非实时行情；财年口径由用户确认。",
                             "CSV为用户整理的指标，上传PDF仅供文本检索，不自动提取财务表。",
                             "模型结论与引用关系需人工复核；当前仅校验引用ID存在。"]
    state["history"].append({"question": question, "summary": report["summary"][:1000]})
    state["history"] = state["history"][-4:]
    return report


def snapshot(state):
    return {"schema": "finpilot.snapshot.v1", "rows": [
        {k: r[k] for k in ("company", "period", "currency", "unit", "revenue", "net_income", "operating_cash_flow")}
        for r in state["rows"]]}


def diff_snapshot(state, old):
    from .data import METRICS, number
    import re
    if not isinstance(old, dict) or old.get("schema") != "finpilot.snapshot.v1" or not isinstance(old.get("rows"), list) or len(old["rows"]) > 500:
        raise ValueError("不是有效的FinPilot快照")
    indexed = {}
    for r in old["rows"]:
        if not isinstance(r, dict) or any(not isinstance(r.get(k), str) for k in ("company", "period", "currency", "unit")):
            raise ValueError("快照字段无效")
        if not re.fullmatch(r"FY20\d{2}(?:-Q[1-4])?", r["period"]) or not re.fullmatch(r"[A-Z]{3}", r["currency"]) or r["unit"] not in {"one", "thousand", "million"}:
            raise ValueError("快照口径无效")
        key = (r["company"], r["period"])
        if key in indexed:
            raise ValueError("快照出现重复期间")
        r = dict(r)
        for k in METRICS:
            if not isinstance(r.get(k), (str, int, float, type(None))) or isinstance(r.get(k), bool):
                raise ValueError("快照数值格式无效")
            r[k] = number(r.get(k), 0, k)
        indexed[key] = r
    changes = []
    current = {(r["company"], r["period"]): r for r in state["rows"]}
    for key, r in current.items():
        before = indexed.get(key)
        if before is None:
            changes.append({"company": key[0], "period": key[1], "type": "new_period"})
        elif (before["currency"], before["unit"]) != (r["currency"], r["unit"]):
            changes.append({"company": key[0], "period": key[1], "type": "incomparable_basis"})
        else:
            for metric in METRICS:
                a, b = before[metric], r[metric]
                from decimal import Decimal
                equal = a is None and b is None or a is not None and b is not None and Decimal(a) == Decimal(b)
                if not equal:
                    changes.append({"company": key[0], "period": key[1], "type": "changed_value", "metric": metric, "before": a, "after": b})
    for key in indexed.keys() - current.keys():
        changes.append({"company": key[0], "period": key[1], "type": "not_in_current_upload"})
    return {"changes": changes, "note": "仅比较两次导入的数据。缺失记录不代表公司删除披露；没有后台自动监控。"}
