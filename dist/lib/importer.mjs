/** Explicit, browser/CLI-shared adapters. No source rows or personal identifiers are retained. */
import { COLUMNS, METRICS } from "./catalog.mjs";
import { normalize } from "./data.mjs";

export const IMPORT_FIELDS = Object.freeze({
  date: "日期 / 业务时间",
  channel: "渠道 / 地区 / 门店（可选）",
  order_id: "订单ID（明细必填且一行一单）",
  status: "订单状态（可选筛选）",
  impressions: "曝光量",
  clicks: "点击量",
  registrations: "注册量",
  orders: "订单量",
  revenue: "销售金额",
  cost: "投放成本",
});
const aliases = {
  date: [
    "date",
    "日期",
    "统计日期",
    "业务日期",
    "支付时间",
    "下单时间",
    "订单日期",
    "InvoiceDate",
    "order_date",
  ],
  channel: [
    "channel",
    "渠道",
    "来源渠道",
    "渠道名称",
    "Country",
    "国家",
    "地区",
    "门店",
    "source",
  ],
  order_id: ["order_id", "订单编号", "订单号", "订单ID", "InvoiceNo"],
  status: ["status", "订单状态", "交易状态", "支付状态"],
  impressions: ["impressions", "曝光量", "展示量"],
  clicks: ["clicks", "点击量", "点击次数"],
  registrations: ["registrations", "注册量", "新增注册"],
  orders: ["orders", "订单量", "成交订单数"],
  revenue: [
    "revenue",
    "付费金额",
    "GMV",
    "销售额",
    "销售金额",
    "实付金额",
    "支付金额",
    "订单金额",
    "total_amount",
  ],
  cost: ["cost", "投放成本", "广告花费", "消耗", "花费"],
};
export function suggestMapping(headers) {
  return Object.fromEntries(
    Object.entries(aliases).map(([field, names]) => {
      const matches = headers.filter((h) =>
        names.some((a) => a.toLowerCase() === h.trim().toLowerCase()),
      );
      return [field, matches.length === 1 ? matches[0] : ""];
    }),
  );
}
const dayAfter = (d) =>
  new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);
export function importDate(value, format = "YMD") {
  if (!["YMD", "DMY", "MDY", "EXCEL"].includes(format))
    throw Error("请选择日期格式");
  let s = String(value ?? "").trim(),
    y,
    m,
    d;
  if (format === "EXCEL") {
    if (!/^\d+(?:\.\d+)?$/.test(s) || +s < 61 || +s > 109574)
      throw Error(
        "Excel日期须为1900日期制的有效序号（不支持虚构的1900-02-29）",
      );
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  // Time-of-day is discarded deliberately, without timezone conversion. Reject offset/UTC timestamps.
  const match = s.match(
    /^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})(?:[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?)?$/,
  );
  if (!match) throw Error("日期格式不符；带时区时间请先转为业务时区的本地时间");
  if (format === "YMD") [, y, m, d] = match;
  if (format === "DMY") [, d, m, y] = match;
  if (format === "MDY") [, m, d, y] = match;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (
    +y < 1900 ||
    +y > 2200 ||
    !Number.isFinite(Date.parse(iso)) ||
    new Date(iso).toISOString().slice(0, 10) !== iso
  )
    throw Error("不存在的日期或超出1900–2200范围");
  return iso;
}
function number(value, field, separators, report) {
  if (
    !["number", "string"].includes(typeof value) ||
    String(value).trim() === ""
  )
    throw Error(`${field} 为空或不是数值`);
  let s = String(value).trim();
  if (separators && /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s))
    s = s.replaceAll(",", "");
  if (!/^\d+(?:\.\d+)?$/.test(s) || !Number.isFinite(+s) || +s > 1e12)
    throw Error(`${field} 须为非负十进制数，金额不能含币种或百分号`);
  if (!["revenue", "cost"].includes(field) && !Number.isInteger(+s))
    throw Error(`${field} 须为整数`);
  if (
    ["revenue", "cost"].includes(field) &&
    (s.split(".")[1]?.length || 0) > 2
  ) {
    const rounded = Math.round(+s * 100) / 100;
    const tolerance = Math.min(
      1e-7,
      Math.max(1e-10, Number.EPSILON * Math.max(1, +s) * 4),
    );
    if (Math.abs(+s - rounded) > tolerance)
      throw Error(`${field} 最多2位小数，请先按统一口径舍入`);
    // Excel may serialize 119.13 as 119.12999999999999. Normalize representation noise only.
    report.precisionNormalized++;
    return rounded;
  }
  return +s;
}
export function metricAvailability(rows) {
  return Object.fromEntries(
    Object.entries(METRICS).map(([metric, spec]) => {
      const missing = [spec.a, spec.b]
        .filter(Boolean)
        .filter(
          (f) => !rows.length || rows.some((r) => !Number.isFinite(r[f])),
        );
      return [metric, { available: missing.length === 0, missing }];
    }),
  );
}
export function prepareImport(input, config = {}) {
  const report = {
    sourceRows: Array.isArray(input) ? input.length : 0,
    acceptedRows: 0,
    excludedRows: 0,
    outputRows: 0,
    aggregatedRows: 0,
    filledRows: 0,
    precisionNormalized: 0,
    errorCount: 0,
    issues: [],
    warnings: [],
    ignoredColumns: [],
  };
  const fail = (row, code, message) => {
    report.errorCount++;
    if (report.issues.length < 100) report.issues.push({ row, code, message });
  };
  try {
    if (!Array.isArray(input) || !input.length || input.length > 20000)
      throw Error("文件须包含1–20,000行");
    if (input.some((r) => !r || typeof r !== "object" || Array.isArray(r)))
      throw Error("每行须为对象");
    const mode = config.mode || "daily",
      mapping = config.mapping || {},
      headers = Object.keys(input[0]);
    if (!["daily", "orders"].includes(mode)) throw Error("未知数据粒度");
    if (!["reject", "sum", undefined].includes(config.duplicates))
      throw Error("未知重复策略");
    const mapped = Object.entries(mapping).filter(
      ([k, v]) => Object.hasOwn(IMPORT_FIELDS, k) && v,
    );
    if (new Set(mapped.map(([, v]) => v)).size !== mapped.length)
      throw Error("同一原始列不能重复映射");
    if (mapped.some(([, v]) => !headers.includes(v)))
      throw Error("映射字段不在表头中");
    if (
      !mapping.date ||
      (mode === "orders" && (!mapping.order_id || !mapping.revenue))
    )
      throw Error("请映射日期；订单明细还须映射订单ID与销售金额");
    if (mode === "daily" && !COLUMNS.slice(2).some((f) => mapping[f]))
      throw Error("请至少映射一个数值指标");
    if (!["CNY", "GBP", "USD", "EUR", "JPY", "HKD"].includes(config.currency))
      throw Error("请选择单一币种，不支持混合币种或自动换汇");
    if (!["gross", "paid"].includes(config.revenueBasis))
      throw Error("请确认销售金额口径");
    if (mode === "orders" && config.complete !== true)
      throw Error("订单明细须确认导出完整且一行一单，不是商品明细");
    const fields =
      mode === "orders"
        ? ["orders", "revenue"]
        : COLUMNS.slice(2).filter((f) => mapping[f]);
    if (
      config.strictFunnel === true &&
      ["impressions", "clicks", "registrations", "orders"].some(
        (f) => !fields.includes(f),
      )
    )
      throw Error("同口径漏斗校验须提供曝光、点击、注册和订单四项");
    const used = new Set(
      mapped
        .filter(([f]) =>
          mode === "daily"
            ? ["date", "channel", ...fields].includes(f)
            : ["date", "channel", "order_id", "status", "revenue"].includes(f),
        )
        .map(([, v]) => v),
    );
    report.ignoredColumns = headers.filter((h) => !used.has(h));
    if (mode === "orders")
      report.warnings.push(
        "订单ID仅用于当前导入去重；未映射的姓名、手机号、地址等字段不进入分析数据。",
      );
    if (mapping.status && mode !== "orders")
      throw Error("状态筛选仅用于订单明细");
    const acceptedStatuses = (config.statusValues || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (mapping.status && !acceptedStatuses.length)
      throw Error("映射状态后须填写纳入的状态值，用英文逗号分隔");
    if (mode === "orders" && !mapping.status)
      report.warnings.push("未按状态筛选：请确保源文件仅含目标状态订单。");
    const groups = new Map(),
      ids = new Set(),
      sourceDates = [];
    for (let i = 0; i < input.length; i++) {
      const raw = input[i];
      try {
        const date = importDate(raw[mapping.date], config.dateFormat || "YMD");
        sourceDates.push(date);
        if (
          mapping.status &&
          !acceptedStatuses.includes(String(raw[mapping.status] ?? "").trim())
        ) {
          report.excludedRows++;
          continue;
        }
        const channel = mapping.channel
          ? String(raw[mapping.channel] ?? "").trim()
          : "全部业务";
        if (!channel || channel.length > 80)
          throw Error("分组字段为空或超过80字符");
        const row = Object.fromEntries(
          COLUMNS.map((f) => [
            f,
            f === "date" ? date : f === "channel" ? channel : null,
          ]),
        );
        for (const f of fields)
          row[f] =
            mode === "orders" && f === "orders"
              ? 1
              : number(raw[mapping[f]], f, config.thousands === true, report);
        if (mode === "orders") {
          if (!["string", "number"].includes(typeof raw[mapping.order_id]))
            throw Error("订单ID须为文本或数字");
          const id = String(raw[mapping.order_id]).trim();
          if (!id || id.length > 200) throw Error("订单ID为空或过长");
          if (ids.has(id))
            throw Error("订单ID重复；请核查重复导出或商品明细，一行须为一单");
          ids.add(id);
        }
        const key = JSON.stringify([date, channel]);
        if (groups.has(key)) {
          if (mode === "daily" && config.duplicates !== "sum")
            throw Error(
              "日期与分组重复；确认是可加的子维度后再选择汇总，不能直接合并重复导出",
            );
          const group = groups.get(key);
          for (const f of fields)
            group[f] = ["revenue", "cost"].includes(f)
              ? (Math.round(group[f] * 100) + Math.round(row[f] * 100)) / 100
              : group[f] + row[f];
          report.aggregatedRows++;
        } else groups.set(key, row);
        report.acceptedRows++;
      } catch (e) {
        fail(i + 2, "INVALID_ROW", e.message);
      }
    }
    if (report.errorCount)
      return {
        ok: false,
        report,
        rows: [],
        error: `${report.errorCount}行存在问题，未替换当前数据。修正后重试。`,
      };
    let rows = [...groups.values()];
    if (!rows.length) throw Error("筛选后没有可分析数据，请确认状态值");
    const channels = [...new Set(rows.map((r) => r.channel))];
    const sortedDates = sourceDates.sort();
    const start = config.coverageStart
      ? importDate(config.coverageStart)
      : sortedDates[0];
    const end = config.coverageEnd
      ? importDate(config.coverageEnd)
      : sortedDates.at(-1);
    const dayCount = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    if (dayCount < 1 || dayCount > 730)
      throw Error("导入覆盖期须为1–730天，较大报表请先按需分段");
    if (rows.some((r) => r.date < start || r.date > end))
      throw Error("有数据超出声明的完整覆盖期；请检查日期");
    let gaps = 0;
    for (let date = start; date <= end; date = dayAfter(date))
      for (const channel of channels) {
        const key = JSON.stringify([date, channel]);
        if (!groups.has(key)) {
          gaps++;
          if (config.fillZeros === true) {
            const row = Object.fromEntries(
              COLUMNS.map((f) => [
                f,
                f === "date"
                  ? date
                  : f === "channel"
                    ? channel
                    : fields.includes(f)
                      ? 0
                      : null,
              ]),
            );
            rows.push(row);
            report.filledRows++;
          }
        }
      }
    if (gaps)
      report.warnings.push(
        config.fillZeros === true
          ? `按你确认的完整导出口径，已将${gaps}个缺失日×分组补为零。若导出不完整，此结果无效。`
          : `存在${gaps}个缺失日×分组；未补零。涉及这些日期的分析将阻止执行。`,
      );
    if (rows.length > 20000)
      throw Error("补齐后超过20,000行，请缩小日期或分组范围");
    rows = normalize(rows, {
      partial: true,
      strictFunnel: config.strictFunnel === true,
    });
    report.outputRows = rows.length;
    const metadata = {
      version: 1,
      currency: config.currency,
      revenueBasis: config.revenueBasis,
      strictFunnel: config.strictFunnel === true,
      mode,
      coverage: { start, end },
      fields,
      zeroFilled: report.filledRows,
      excludedRows: report.excludedRows,
    };
    return {
      ok: true,
      rows,
      metadata,
      report,
      availability: metricAvailability(rows),
    };
  } catch (e) {
    fail(null, "IMPORT_CONFIG", e.message);
    return { ok: false, rows: [], report, error: e.message };
  }
}
export function issuesCSV(report) {
  const q = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  return (
    "\uFEFF" +
    [
      ["row", "code", "message"],
      ...report.issues.map((x) => [x.row, x.code, x.message]),
    ]
      .map((r) => r.map(q).join(","))
      .join("\r\n")
  );
}
