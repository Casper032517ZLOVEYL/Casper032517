"""Orchestration reuses the exact same JS engine as the browser."""

import json
import subprocess
import time
import urllib.error

from .config import ROOT, Settings
from .model import complete, validate_insights


def run_tool(payload):
    process = subprocess.run(
        ["node", str(ROOT / "tools" / "analyze.mjs")], input=json.dumps(payload, ensure_ascii=False),
        text=True, capture_output=True, timeout=15, check=True, cwd=ROOT,
    )
    return json.loads(process.stdout)


def usage_metrics(usage, settings):
    if not isinstance(usage, dict):
        return {"usage": None, "cost_usd": None}
    pt, ct = usage.get("prompt_tokens"), usage.get("completion_tokens")
    if any(isinstance(x, bool) or not isinstance(x, int) or x < 0 for x in (pt, ct)):
        return {"usage": None, "cost_usd": None}
    cost = None
    if settings.input_price is not None and settings.output_price is not None:
        cost = (pt * settings.input_price + ct * settings.output_price) / 1_000_000
    return {"usage": {"prompt_tokens": pt, "completion_tokens": ct}, "cost_usd": cost}


def analyze_request(payload, settings=None, client=None):
    settings = settings or Settings.from_env()
    start = time.perf_counter()
    result = run_tool(payload)
    result.update(ai=False, ai_status="disabled", usage=None, cost_usd=None)
    if not result.get("ok") or not settings.enabled or result.get("definition"):
        result["total_latency_ms"] = (time.perf_counter() - start) * 1000
        return result
    # Only aggregates and evidence are sent, not uploaded raw records or filenames.
    evidence = {"question": payload["question"], "plan": result["plan"], "range": result["range"],
                "current": result["current"], "previous": result["previous"],
                "details": result["details"], "formula": result["formula"], "knowledge": result["knowledge"]}
    usage = None
    try:
        content, usage = (client or complete)(settings, evidence)
        insights = validate_insights(content, result["knowledge"])
        result.update(ai=True, ai_status="complete", model=settings.model, ai_insights=insights,
                      ai_text="\n".join(f"待验证：{x['hypothesis']}\n验证：{x['validation']} [{', '.join(x['evidence_ids'])}]" for x in insights)
                      or "模型没有找到足够依据提出额外假设。")
    except (ValueError, KeyError, IndexError, TypeError, OSError, TimeoutError, urllib.error.URLError):
        result.update(ai_status="fallback", ai_text="模型暂不可用或证据引用校验未通过，已保留计算结果。")
    result.update(usage_metrics(usage, settings))
    result["total_latency_ms"] = (time.perf_counter() - start) * 1000
    return result
