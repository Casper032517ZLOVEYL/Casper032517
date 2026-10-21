// Minimal read-only XLSX parser. No macros, formulas, external links or evaluation.
export async function readXlsx(buffer) {
  const bytes = new Uint8Array(buffer),
    dv = new DataView(buffer),
    decoder = new TextDecoder();
  let e = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      e = i;
      break;
    }
  if (e < 0) throw Error("无效 XLSX ZIP 文件");
  const count = dv.getUint16(e + 10, true);
  if (count > 500) throw Error("工作簿文件过于复杂");
  let pos = dv.getUint32(e + 16, true),
    total = 0,
    files = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) throw Error("ZIP 目录损坏");
    let method = dv.getUint16(pos + 10, true),
      size = dv.getUint32(pos + 20, true),
      expanded = dv.getUint32(pos + 24, true),
      nl = dv.getUint16(pos + 28, true),
      xl = dv.getUint16(pos + 30, true),
      cl = dv.getUint16(pos + 32, true),
      off = dv.getUint32(pos + 42, true);
    total += expanded;
    if (total > 20 * 1024 * 1024) throw Error("解压后超过 20 MB 限制");
    const name = decoder.decode(bytes.slice(pos + 46, pos + 46 + nl));
    files[name] = { off, size, method, expanded };
    pos += 46 + nl + xl + cl;
  }
  async function xml(name) {
    let f = files[name];
    if (!f) return null;
    let start =
      f.off +
      30 +
      dv.getUint16(f.off + 26, true) +
      dv.getUint16(f.off + 28, true);
    let src = bytes.slice(start, start + f.size),
      out;
    if (f.method === 0) out = src;
    else if (f.method === 8) {
      let stream = new Blob([src])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader();
      let parts = [],
        length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > f.expanded || length > 20 * 1024 * 1024) {
          await reader.cancel();
          throw Error("解压长度超过声明值");
        }
        parts.push(value);
      }
      out = new Uint8Array(length);
      let p = 0;
      for (let a of parts) {
        out.set(a, p);
        p += a.length;
      }
    } else throw Error("不支持该压缩格式");
    const doc = new DOMParser().parseFromString(
      decoder.decode(out),
      "application/xml",
    );
    if (doc.querySelector("parsererror")) throw Error("工作表 XML 损坏");
    return doc;
  }
  const book = await xml("xl/workbook.xml"),
    rels = await xml("xl/_rels/workbook.xml.rels");
  if (
    book
      ?.getElementsByTagNameNS("*", "workbookPr")[0]
      ?.getAttribute("date1904") === "1"
  )
    throw Error("请将1904日期制工作簿中的日期转换为 YYYY-MM-DD 文本");
  let sheet = book?.getElementsByTagNameNS("*", "sheet")[0];
  if (!sheet) throw Error("没有工作表");
  let rid = sheet.getAttribute("r:id"),
    rel = [...(rels?.getElementsByTagNameNS("*", "Relationship") || [])].find(
      (x) => x.getAttribute("Id") === rid,
    );
  let target = rel?.getAttribute("Target") || "worksheets/sheet1.xml";
  if (target.includes("..") || target.includes("://"))
    throw Error("不支持外部工作表");
  target = target.startsWith("/") ? target.slice(1) : "xl/" + target;
  const doc = await xml(target);
  if (!doc) throw Error("找不到首个工作表");
  const shared = await xml("xl/sharedStrings.xml");
  let strings = shared
    ? [...shared.getElementsByTagNameNS("*", "si")].map((x) => x.textContent)
    : [];
  let grid = [];
  for (let row of doc.getElementsByTagNameNS("*", "row")) {
    let r = [];
    for (let c of row.getElementsByTagNameNS("*", "c")) {
      if (c.getElementsByTagNameNS("*", "f").length)
        throw Error("请先把 Excel 公式粘贴为值");
      let ref = c.getAttribute("r") || "",
        col = 0;
      for (let ch of ref.replace(/[0-9]/g, ""))
        col = col * 26 + ch.charCodeAt(0) - 64;
      if (col > 100) throw Error("最多读取 100 列");
      if (c.getAttribute("t") === "b")
        throw Error("Excel 布尔值不能作为业务字段，请先确认口径");
      const t = c.getAttribute("t"),
        v = c.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
      r[col - 1] =
        t === "s"
          ? strings[Number(v)]
          : t === "inlineStr"
            ? (c.getElementsByTagNameNS("*", "is")[0]?.textContent ?? "")
            : v;
    }
    if (r.some((v) => v !== "" && v !== undefined)) grid.push(r);
    if (grid.length > 20001) throw Error("最多支持 20,000 行");
  }
  if (grid.length < 2) throw Error("没有数据");
  const header = grid.shift().map((v) => String(v).trim());
  if (new Set(header).size !== header.length) throw Error("表头重复");
  return grid.map((r) =>
    Object.fromEntries(
      header.map((h, i) => {
        let v = r[i] ?? "";
        if ((h === "date" || h === "日期") && /^\d+(\.0+)?$/.test(v))
          v = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000)
            .toISOString()
            .slice(0, 10);
        return [h, v];
      }),
    ),
  );
}
