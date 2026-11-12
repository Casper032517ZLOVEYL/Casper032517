"""Strict import contracts and bounded document extraction. No network or disk writes."""
import csv
import hashlib
import io
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlsplit

METRICS = ("revenue", "net_income", "operating_cash_flow")
LABELS = {"revenue": "营业收入", "net_income": "净利润", "operating_cash_flow": "经营现金流"}
REQUIRED = ("company", "period", "currency", "unit", *METRICS)
MAX_BYTES = 5 * 1024 * 1024


def safe_url(value):
    value = str(value or "").strip()
    p = urlsplit(value)
    return value if p.scheme == "https" and p.hostname and not p.username and not p.password else ""


def number(value, row, name):
    if value is None or str(value).strip() == "":
        return None
    try:
        n = Decimal(str(value).strip())
        if not n.is_finite() or abs(n) > Decimal("1e18") or n.as_tuple().exponent < -6:
            raise InvalidOperation
        return str(n)
    except InvalidOperation:
        raise ValueError(f"第{row}行 {name} 需为绝对值≤1e18、最多6位小数的有限数值或留空，不支持千位分隔符") from None


def parse_csv(content, name="metrics.csv"):
    if len(content) > MAX_BYTES:
        raise ValueError("单个文件不得超过5MB")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("CSV请使用UTF-8编码") from None
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or not set(REQUIRED).issubset(reader.fieldnames):
        raise ValueError("CSV缺少字段：" + ", ".join(REQUIRED))
    if len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise ValueError("CSV列名不能重复")
    rows, seen, basis = [], set(), {}
    file_digest = hashlib.sha256(content).hexdigest()
    for i, raw in enumerate(reader, 2):
        if i > 501:
            raise ValueError("最多导入500条财务记录")
        row = {k: str(raw.get(k) or "").strip() for k in ("company", "period", "currency", "unit")}
        if not row["company"] or len(row["company"]) > 100:
            raise ValueError(f"第{i}行公司名称为空或过长")
        if not re.fullmatch(r"FY20\d{2}(?:-Q[1-4])?", row["period"]):
            raise ValueError(f"第{i}行期间须为FY2024或FY2024-Q1；季度仅接受单季度值")
        if not re.fullmatch(r"[A-Z]{3}", row["currency"]) or row["unit"] not in {"one", "thousand", "million"}:
            raise ValueError(f"第{i}行币种需三位大写代码，单位需one/thousand/million")
        key = (row["company"], row["period"])
        if key in seen:
            raise ValueError(f"第{i}行公司与期间重复；请先解决重述或口径冲突")
        seen.add(key)
        b = (row["currency"], row["unit"])
        if row["company"] in basis and basis[row["company"]] != b:
            raise ValueError("同一公司必须使用相同币种和单位")
        basis[row["company"]] = b
        for k in METRICS:
            row[k] = number(raw.get(k), i, k)
        if row["revenue"] is not None and Decimal(row["revenue"]) < 0:
            raise ValueError(f"第{i}行营业收入不能为负")
        if all(row[k] is None for k in METRICS):
            raise ValueError(f"第{i}行至少需要一个财务指标")
        row["source"] = safe_url(raw.get("source"))
        row["location"] = str(raw.get("location") or "用户提供的结构化数据，未独立核验")[:250]
        row["file"] = Path(name).name[:120]
        digest = hashlib.sha256((name + str(i) + file_digest).encode()).hexdigest()[:12]
        row["id"] = "E-" + digest
        rows.append(row)
    if not rows:
        raise ValueError("CSV没有数据记录")
    return rows


def parse_document(content, name):
    if len(content) > MAX_BYTES:
        raise ValueError("单个文件不得超过5MB")
    ext = Path(name).suffix.lower()
    pages = []
    if ext == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            raise ValueError("PDF需要先安装requirements.txt中的pypdf") from None
        try:
            reader = PdfReader(io.BytesIO(content))
            if reader.is_encrypted or len(reader.pages) > 100:
                raise ValueError("仅接受未加密且不超过100页的PDF；大报告请先拆分")
            for i, page in enumerate(reader.pages, 1):
                pages.append((i, page.extract_text() or ""))
        except ValueError:
            raise
        except Exception:
            raise ValueError("PDF无法解析，请改传文本版") from None
    elif ext in {".txt", ".md"}:
        try:
            pages = [(1, content.decode("utf-8-sig"))]
        except UnicodeDecodeError:
            raise ValueError("文本请使用UTF-8编码") from None
    else:
        raise ValueError("支持CSV、PDF、TXT、MD")
    size = sum(len(t) for _, t in pages)
    if size > 300_000:
        raise ValueError("单份文档文本超过30万字符，请先拆分")
    if size < 20:
        raise ValueError("未提取到足够文本；扫描PDF需先做OCR")
    chunks = []
    digest = hashlib.sha256(content).hexdigest()[:10]
    for page, text in pages:
        for start in range(0, len(text), 1000):
            snippet = text[start:start + 1200].strip()
            if snippet:
                chunks.append({"id": f"D-{digest}-{page}-{start}", "file": Path(name).name[:120],
                               "page": page, "text": snippet})
    return chunks


def validate_dataset(rows):
    if len(rows) > 500:
        raise ValueError("全部CSV合计最多500条记录")
    seen, basis = set(), {}
    for r in rows:
        key = (r["company"], r["period"])
        if key in seen:
            raise ValueError("不同文件出现同公司、同期间记录；请先解决重复或重述")
        seen.add(key)
        b = (r["currency"], r["unit"])
        if r["company"] in basis and basis[r["company"]] != b:
            raise ValueError("跨文件的同公司币种和单位必须一致")
        basis[r["company"]] = b
