"""Deterministic arithmetic and evidence retrieval; no generated numbers."""
import re
from decimal import Decimal, ROUND_HALF_UP, localcontext
from .data import LABELS, METRICS


def rounded(x):
    with localcontext() as context:
        context.prec = 60
        return float(x.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def growth(now, before):
    if now is None or before is None or Decimal(before) <= 0:
        return None
    return rounded((Decimal(now) / Decimal(before) - 1) * 100)


def calculate(rows, company):
    selected = sorted((r for r in rows if r["company"] == company), key=lambda r: r["period"])
    if not selected:
        raise ValueError("未找到公司，请先调用list_companies确认名称")
    by_period = {r["period"]: r for r in selected}
    results = []
    for row in selected:
        prior = "FY" + str(int(row["period"][2:6]) - 1) + row["period"][6:]
        previous = by_period.get(prior)
        yoy = {k: growth(row[k], previous[k]) if previous else None for k in METRICS}
        warnings = []
        for k in METRICS:
            if row[k] is None:
                warnings.append(f"缺少{LABELS[k]}")
            if previous and previous[k] is not None and Decimal(previous[k]) <= 0:
                warnings.append(f"{LABELS[k]}上年基数非正，不计算常规同比")
        if not previous:
            warnings.append("缺少上年同期，无法计算同比")
        margin = None
        if row["revenue"] is not None and Decimal(row["revenue"]) > 0 and row["net_income"] is not None:
            margin = rounded(Decimal(row["net_income"]) / Decimal(row["revenue"]) * 100)
        results.append({"company": company, "period": row["period"], "currency": row["currency"],
                        "unit": row["unit"], "values": {k: row[k] for k in METRICS}, "yoy_pct": yoy,
                        "net_margin_pct": margin, "evidence_ids": [row["id"]] + ([previous["id"]] if previous else []),
                        "warnings": warnings})
    return results


def search(chunks, query, limit=4):
    # Transparent lexical search, not embeddings. Chinese bigrams + English words.
    if not isinstance(query, str) or not query.strip():
        raise ValueError("检索词不能为空")
    query = query[:200].lower()
    terms = set(re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]{2}", query))
    han = "".join(re.findall(r"[\u4e00-\u9fff]", query))
    terms.update(han[i:i+2] for i in range(len(han)-1))
    scored = [(sum(min(c["text"].lower().count(t), 5) for t in terms), c) for c in chunks]
    return [dict(c, score=s) for s, c in sorted(scored, key=lambda x: -x[0])[:limit] if s > 0]


class Toolbox:
    def __init__(self, rows, chunks):
        self.rows, self.chunks = rows, chunks
        self.exposed = {}
        self.calculations = {}

    def call(self, name, args):
        if not isinstance(args, dict):
            raise ValueError("工具参数必须为对象")
        if name == "list_companies":
            if args:
                raise ValueError("list_companies无需参数")
            return {"companies": sorted({r["company"] for r in self.rows}), "document_chunks": len(self.chunks)}
        if name == "calculate_metrics":
            if set(args) != {"company"} or not isinstance(args["company"], str):
                raise ValueError("需要company字符串")
            results = calculate(self.rows, args["company"])
            self.calculations[args["company"]] = results
            ids = {e for r in results for e in r["evidence_ids"]}
            self.exposed.update({r["id"]: r for r in self.rows if r["id"] in ids})
            return results
        if name == "search_documents":
            if set(args) != {"query"}:
                raise ValueError("需要query字符串")
            results = search(self.chunks, args["query"])
            self.exposed.update({r["id"]: r for r in results})
            return results
        if name == "read_evidence":
            if set(args) != {"evidence_id"} or not isinstance(args["evidence_id"], str):
                raise ValueError("需要evidence_id字符串")
            found = self.exposed.get(args["evidence_id"])
            if not found:
                raise ValueError("只能读取此前工具已返回的证据ID")
            return found
        raise ValueError("未知工具；仅开放list_companies/calculate_metrics/search_documents/read_evidence")


def workflow(toolbox, question):
    """Offline baseline. Explicitly a rule workflow, not an autonomous model."""
    trace, findings, questions = [], [], []
    catalog = toolbox.call("list_companies", {})
    trace.append({"tool": "list_companies", "arguments": {}, "status": "ok", "result": catalog})
    mentioned = [c for c in catalog["companies"] if c.lower() in question.lower()]
    companies = mentioned or catalog["companies"][:5]
    for company in companies:
        results = toolbox.call("calculate_metrics", {"company": company})
        trace.append({"tool": "calculate_metrics", "arguments": {"company": company}, "status": "ok", "result": results})
        for suffix in ("", "-Q1", "-Q2", "-Q3", "-Q4"):
            group = [r for r in results if r["period"][6:] == suffix]
            if not group:
                continue
            r = group[-1]
            pieces = []
            for k in METRICS:
                if r["values"][k] is not None:
                    pct = r["yoy_pct"][k]
                    pieces.append(f"{LABELS[k]} {r['values'][k]} {r['currency']} ({r['unit']})" +
                                  (f"，同比{pct:+.2f}%" if pct is not None else "，同比不可计算"))
            findings.append({"kind": "calculation", "text": f"{company} {r['period']}：" + "；".join(pieces),
                             "evidence_ids": r["evidence_ids"]})
            if r["yoy_pct"]["net_income"] is not None and r["yoy_pct"]["operating_cash_flow"] is not None:
                if r["yoy_pct"]["net_income"] > 0 and r["yoy_pct"]["operating_cash_flow"] < 0:
                    findings.append({"kind": "hypothesis", "text": "利润与经营现金流同比方向背离；需检查营运资本和一次性项目，当前不能判断原因。", "evidence_ids": r["evidence_ids"]})
            questions.extend(f"{company} {r['period']}：{w}" for w in r["warnings"])
    if toolbox.chunks:
        query = question[:200]
        found = toolbox.call("search_documents", {"query": query})
        trace.append({"tool": "search_documents", "arguments": {"query": query}, "status": "ok", "result": found})
        questions.append("已返回相关原文片段；离线模式不自动解释文本因果，请查看证据或启用模型。")
    if not companies:
        questions.append("没有结构化财务数据；上传CSV可获得可复算指标，文档仅用于检索。")
    if not mentioned and len(catalog["companies"]) > 5:
        questions.append("离线模式本次仅分析前5家公司，请在问题中指定公司。")
    return {"summary": "已完成可复算的财务指标检查。离线模式使用固定规则，不具备自主规划能力。",
            "findings": findings, "open_questions": list(dict.fromkeys(questions)), "trace": trace,
            "status": "completed", "mode": "offline_workflow"}
