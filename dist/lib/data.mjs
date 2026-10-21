import { COLUMNS } from "./catalog.mjs";

const ALIASES = Object.freeze({
  日期: "date",
  渠道: "channel",
  曝光量: "impressions",
  点击量: "clicks",
  注册量: "registrations",
  订单量: "orders",
  付费金额: "revenue",
  投放成本: "cost",
  GMV: "revenue",
});

/** RFC-style UTF-8 CSV, including quoted delimiters, newlines and doubled quotes. */
export function parseCSV(text, { delimiter = "," } = {}) {
  if (![",", "\t", ";"].includes(delimiter)) throw new Error("不支持该分隔符");
  if (typeof text !== "string") throw new Error("CSV 内容必须是文本");
  const grid = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.trim())) grid.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  row.push(cell);
  if (row.some((value) => value.trim())) grid.push(row);
  if (grid.length < 2) throw new Error("文件没有数据行");
  const header = grid
    .shift()
    .map((value) => value.replace(/^\uFEFF/, "").trim());
  if (header.length > 100 || grid.length > 20000)
    throw new Error("最多支持100列、20,000行");
  if (header.some((key) => !key) || new Set(header).size !== header.length) {
    throw new Error("表头为空或重复");
  }
  return grid.map((cells, index) => {
    if (cells.length !== header.length)
      throw new Error(`第 ${index + 2} 行列数与表头不同`);
    return Object.fromEntries(
      header.map((key, column) => [key, cells[column]]),
    );
  });
}

export function normalize(
  input,
  { partial = false, strictFunnel = !partial } = {},
) {
  if (!Array.isArray(input) || !input.length)
    throw new Error("没有可分析的数据");
  if (input.length > 20000) throw new Error("最多支持 20,000 行");
  const seen = new Set(),
    channels = new Set();
  const result = input.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error(`第 ${index + 2} 行不是对象`);
    const row = Object.create(null);
    for (const [original, value] of Object.entries(raw)) {
      const key = Object.hasOwn(ALIASES, original)
        ? ALIASES[original]
        : original;
      if (Object.hasOwn(row, key))
        throw new Error(`第 ${index + 2} 行字段映射重复：${key}`);
      row[key] = value;
    }
    for (const key of partial ? COLUMNS.slice(0, 2) : COLUMNS) {
      if (
        row[key] === undefined ||
        row[key] === null ||
        String(row[key]).trim() === ""
      ) {
        throw new Error(`第 ${index + 2} 行缺少 ${key}`);
      }
    }
    if (typeof row.date !== "string" || typeof row.channel !== "string")
      throw new Error("日期和渠道必须是文本");
    row.date = row.date.trim();
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Number.isFinite(Date.parse(row.date)) ||
      new Date(row.date).toISOString().slice(0, 10) !== row.date
    ) {
      throw new Error(`第 ${index + 2} 行日期须为有效 YYYY-MM-DD`);
    }
    row.channel = row.channel.trim();
    if (!row.channel || row.channel.length > 80)
      throw new Error("渠道名必须为 1–80 字符");
    const key = JSON.stringify([row.date, row.channel]);
    if (seen.has(key))
      throw new Error(
        `日期与渠道重复：${row.date} / ${row.channel}。请先按日和渠道汇总`,
      );
    seen.add(key);
    channels.add(row.channel);
    for (const key of COLUMNS.slice(2)) {
      const value = row[key];
      if (partial && (value === null || value === undefined)) {
        row[key] = null;
        continue;
      }
      if (
        !["string", "number"].includes(typeof value) ||
        (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim()))
      ) {
        throw new Error(`第 ${index + 2} 行 ${key} 须为十进制非负数`);
      }
      row[key] = Number(value);
      if (!Number.isFinite(row[key]) || row[key] < 0 || row[key] > 1e12)
        throw new Error(`第 ${index + 2} 行 ${key} 超出数值范围`);
      if (!["revenue", "cost"].includes(key) && !Number.isInteger(row[key]))
        throw new Error(`第 ${index + 2} 行 ${key} 须为整数`);
    }
    if (
      strictFunnel &&
      (row.clicks > row.impressions ||
        row.registrations > row.clicks ||
        row.orders > row.registrations)
    ) {
      throw new Error(
        `第 ${index + 2} 行漏斗不符合 曝光≥点击≥注册≥订单。本版仅支持同口径漏斗`,
      );
    }
    if (partial && COLUMNS.slice(2).every((key) => row[key] === null))
      throw new Error(`第 ${index + 2} 行没有可分析的指标`);
    return Object.fromEntries(COLUMNS.map((key) => [key, row[key]]));
  });
  if (channels.size > 20) throw new Error("最多支持 20 个渠道，请先汇总");
  return result.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel),
  );
}
