import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import {
  prepareImport,
  importDate,
  suggestMapping,
  metricAvailability,
} from "../dist/lib/importer.mjs";
import { parseCSV, analyze, narrative } from "../dist/core.mjs";
import { markdownReport } from "../dist/lib/reports.mjs";
const records = () =>
  Array.from({ length: 14 }, (_, i) => ({
    业务日期: `2026-01-${String(i + 1).padStart(2, "0")}`,
    来源: "门店A",
    销售额: i < 7 ? "100.20" : "200.40",
    订单数: "3",
    手机号: "DO_NOT_RETAIN",
  }));
const config = () => ({
  mode: "daily",
  mapping: {
    date: "业务日期",
    channel: "来源",
    revenue: "销售额",
    orders: "订单数",
  },
  currency: "CNY",
  revenueBasis: "paid",
});
const imported = (raw = records(), options = {}) =>
  prepareImport(raw, { ...config(), ...options });
const ask = (d, q, options = {}) =>
  analyze(d.rows, q, null, { dataset: d.metadata, ...options });

test("partial reports with no funnel are accepted and PII fields removed", () => {
  const d = imported();
  assert.equal(d.ok, true);
  assert.equal(d.rows[0].clicks, null);
  assert.equal(d.rows[0].手机号, undefined);
  assert.ok(d.report.ignoredColumns.includes("手机号"));
  assert.ok(ask(d, "GMV").ok);
  assert.equal(d.availability.roas.available, false);
});
test("missing cost never becomes zero or an invented ROAS", () => {
  const r = ask(imported(), "ROAS");
  assert.equal(r.ok, false);
  assert.match(r.error, /cost/);
});
test("missing fields cannot leak into aggregate evidence as zero", () => {
  const r = ask(imported(), "GMV");
  assert.equal(r.evidence.current.clicks, null);
});
test("currency is preserved in result, narrative and exported report", () => {
  const d = imported(undefined, { currency: "GBP" }),
    r = ask(d, "GMV");
  assert.equal(r.currency, "GBP");
  assert.match(narrative(r), /GBP/);
  assert.match(
    markdownReport({ source: "case", question: "GMV", result: r }),
    /GBP/,
  );
});
test("explicit range compares previous equal-length dates", () => {
  const r = ask(imported(), "GMV", {
    range: { start: "2026-01-06", end: "2026-01-10" },
  });
  assert.ok(r.ok);
  assert.equal(r.plan.days, 5);
  assert.equal(r.range.prevBegin, "2026-01-01");
  assert.ok(Math.abs(r.current - 801.6) < 1e-8);
});
test("question window conflicts are never silently overridden", () => {
  assert.equal(
    ask(imported(), "最近7天GMV", {
      range: { start: "2026-01-06", end: "2026-01-10" },
    }).ok,
    false,
  );
});
test("inverted or invalid ranges are rejected", () => {
  for (const range of [
    { start: "2026-01-14", end: "2026-01-01" },
    { start: "2026-02-30", end: "2026-03-01" },
  ])
    assert.equal(ask(imported(), "GMV", { range }).ok, false);
});
test("daily duplicates block unless additive grouping is explicitly chosen", () => {
  const raw = records();
  raw.push({ ...raw[0] });
  assert.equal(imported(raw).ok, false);
  const d = imported(raw, { duplicates: "sum" });
  assert.ok(d.ok);
  assert.equal(d.rows[0].revenue, 200.4);
  assert.equal(d.report.aggregatedRows, 1);
});
test("daily blank mapped amount is an error with source row number", () => {
  const raw = records();
  raw[3].销售额 = "";
  const d = imported(raw);
  assert.equal(d.ok, false);
  assert.equal(d.report.issues[0].row, 5);
  assert.equal(d.rows.length, 0);
});
test("unknown unselected fields do not affect math", () => {
  const raw = records();
  raw[0]["revenue"] = 999999;
  assert.equal(imported(raw).rows[0].revenue, 100.2);
});
test("one source column cannot be mapped to two metrics", () => {
  assert.equal(
    imported(undefined, {
      mapping: { date: "业务日期", revenue: "销售额", cost: "销售额" },
    }).ok,
    false,
  );
});
test("ambiguous aliases are not guessed", () => {
  assert.equal(suggestMapping(["日期", "支付时间", "销售金额"]).date, "");
});
test("no channel maps to explicit all-business group", () => {
  const d = imported(undefined, {
    mapping: { date: "业务日期", revenue: "销售额" },
  });
  assert.ok(d.ok);
  assert.equal(d.rows[0].channel, "全部业务");
});
test("funnel is opt-in; legitimate old-user orders can exceed registrations", () => {
  const raw = records().map((r) => ({ ...r, 注册: "1", 点击: "2", 曝光: "4" }));
  const mapping = {
    ...config().mapping,
    registrations: "注册",
    clicks: "点击",
    impressions: "曝光",
  };
  assert.ok(imported(raw, { mapping }).ok);
  assert.equal(imported(raw, { mapping, strictFunnel: true }).ok, false);
});
test("missing calendar day remains missing unless explicitly authorized to fill", () => {
  const raw = records().filter((_, i) => i !== 9);
  const d = imported(raw);
  assert.ok(d.ok);
  assert.equal(d.report.filledRows, 0);
  assert.equal(ask(d, "GMV").ok, false);
  const filled = imported(raw, { fillZeros: true });
  assert.ok(filled.ok);
  assert.equal(filled.report.filledRows, 1);
  assert.equal(filled.rows.find((r) => r.date === "2026-01-10").revenue, 0);
  assert.ok(ask(filled, "GMV").ok);
});
test("declared coverage can reveal missing end days and never truncates input", () => {
  const d = imported(undefined, { coverageEnd: "2026-01-16", fillZeros: true });
  assert.equal(d.rows.at(-1).date, "2026-01-16");
  assert.equal(d.report.filledRows, 2);
  assert.equal(imported(undefined, { coverageEnd: "2026-01-13" }).ok, false);
});
test("strict numeric formats prevent percent or currency being treated as totals", () => {
  for (const value of ["¥100", "10%", "1e3", "-4", "NaN", true]) {
    const raw = records();
    raw[0].销售额 = value;
    assert.equal(imported(raw).ok, false);
  }
});
test("thousand separators require opt-in and correct grouping", () => {
  const raw = records();
  raw[0].销售额 = "1,200.50";
  assert.equal(imported(raw).ok, false);
  assert.equal(imported(raw, { thousands: true }).rows[0].revenue, 1200.5);
  raw[0].销售额 = "1,20.50";
  assert.equal(imported(raw, { thousands: true }).ok, false);
});
test("money precision over 2 decimals blocks instead of silently rounding", () => {
  const raw = records();
  raw[0].销售额 = "1.005";
  assert.equal(imported(raw).ok, false);
});
test("ISO, DMY, MDY and Excel dates are explicit and invalid dates fail", () => {
  assert.equal(importDate("2026/1/2 23:59:59"), "2026-01-02");
  assert.equal(importDate("02/01/2026", "DMY"), "2026-01-02");
  assert.equal(importDate("01/02/2026", "MDY"), "2026-01-02");
  assert.equal(importDate("46024", "EXCEL"), "2026-01-02");
  for (const value of [
    "2026-02-30",
    "2026-01-02T00:00:00Z",
    "2026-01-02 25:00",
  ])
    assert.throws(() => importDate(value));
  assert.throws(() => importDate("60", "EXCEL"));
});
test("semicolon and tab source exports preserve correct fields", () => {
  assert.equal(parseCSV("a;b\n1;2", { delimiter: ";" })[0].b, "2");
  assert.equal(parseCSV("a\tb\n1\t2", { delimiter: "\t" })[0].b, "2");
});
const orderRaw = () => [
  { 时间: "2026-01-01", ID: "001", 金额: "0.10", 状态: "已支付", 店铺: "A" },
  { 时间: "2026-01-01", ID: "002", 金额: "0.20", 状态: "已支付", 店铺: "A" },
  { 时间: "2026-01-02", ID: "003", 金额: "999", 状态: "已取消", 店铺: "A" },
];
const orderConfig = () => ({
  mode: "orders",
  mapping: {
    date: "时间",
    order_id: "ID",
    revenue: "金额",
    status: "状态",
    channel: "店铺",
  },
  statusValues: "已支付",
  complete: true,
  currency: "CNY",
  revenueBasis: "paid",
});
test("one-row-per-order adapter filters statuses, counts IDs and sums cents", () => {
  const d = prepareImport(orderRaw(), orderConfig());
  assert.ok(d.ok);
  assert.equal(d.rows[0].revenue, 0.3);
  assert.equal(d.rows[0].orders, 2);
  assert.equal(d.rows[0].order_id, undefined);
  assert.equal(d.report.excludedRows, 1);
});
test("order detail requires completeness declaration", () => {
  assert.equal(
    prepareImport(orderRaw(), { ...orderConfig(), complete: false }).ok,
    false,
  );
});
test("repeated order ID blocks, preventing line-item revenue double counts", () => {
  const raw = orderRaw();
  raw.push({ ...raw[0] });
  const d = prepareImport(raw, orderConfig());
  assert.equal(d.ok, false);
  assert.match(d.report.issues[0].message, /订单ID重复/);
});
test("mapped status requires explicit accepted values", () => {
  assert.equal(
    prepareImport(orderRaw(), { ...orderConfig(), statusValues: "" }).ok,
    false,
  );
});
test("unrecognized status never silently counts as paid", () => {
  const d = prepareImport(orderRaw(), {
    ...orderConfig(),
    statusValues: "完成",
  });
  assert.equal(d.ok, false);
  assert.equal(d.report.excludedRows, 3);
});
test("mixed/unknown currency configs fail", () => {
  assert.equal(imported(undefined, { currency: "MIXED" }).ok, false);
});
test("data errors are bounded for a useful quarantine report", () => {
  const d = imported(
    Array.from({ length: 200 }, () => ({ ...records()[0], 销售额: "" })),
  );
  assert.equal(d.report.errorCount, 200);
  assert.equal(d.report.issues.length, 100);
});
test("all missing metrics cannot become an empty successful dataset", () => {
  assert.equal(
    imported(undefined, { mapping: { date: "业务日期" } }).ok,
    false,
  );
});
test("actual public UCI daily report reconciles independently computed gold", () => {
  const raw = parseCSV(
    fs.readFileSync(
      new URL("../dist/datasets/uci-daily-nov2011.csv", import.meta.url),
      "utf8",
    ),
  );
  const d = prepareImport(raw, {
    mode: "daily",
    mapping: {
      date: "date",
      channel: "channel",
      orders: "orders",
      revenue: "revenue",
    },
    currency: "GBP",
    revenueBasis: "gross",
    fillZeros: true,
    coverageStart: "2011-11-01",
    coverageEnd: "2011-11-30",
  });
  assert.ok(d.ok);
  assert.equal(d.rows.length, 30);
  assert.equal(d.report.filledRows, 4);
  assert.equal(
    d.rows.reduce((s, r) => s + r.orders, 0),
    2490,
  );
  const r = ask(d, "销售金额");
  assert.ok(r.ok);
  assert.ok(Math.abs(r.current - 277736.03) < 1e-7);
  assert.ok(Math.abs(r.previous - 284447.21) < 1e-7);
  assert.equal(r.currency, "GBP");
  assert.equal(r.evidence.current.cost, null);
});
test("actual UCI order import and daily import reconcile, without fabricating paid status", () => {
  const text = fs.readFileSync(
    new URL("../dist/datasets/uci-orders-nov2011.csv", import.meta.url),
    "utf8",
  );
  const d = prepareImport(parseCSV(text), {
    mode: "orders",
    mapping: {
      date: "date",
      channel: "channel",
      revenue: "revenue",
      order_id: "order_id",
    },
    complete: true,
    currency: "GBP",
    revenueBasis: "gross",
    fillZeros: true,
  });
  assert.ok(d.ok);
  assert.equal(d.rows.length, 30);
  assert.equal(d.report.sourceRows, 2490);
  assert.equal(
    d.rows.reduce((s, r) => s + r.orders, 0),
    2490,
  );
  assert.ok(
    Math.abs(d.rows.reduce((s, r) => s + r.revenue, 0) - 1325346.21) < 1e-6,
  );
  assert.equal(ask(d, "销售金额").data_contract.revenueBasis, "gross");
});
test("published real fixtures are pinned by SHA256 and public attribution", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      new URL("../dist/datasets/uci-manifest.json", import.meta.url),
    ),
  );
  assert.equal(manifest.counts.source_rows, 541909);
  assert.equal(manifest.license, "CC BY 4.0");
  for (const [name, hash] of Object.entries(manifest.files))
    assert.equal(
      crypto
        .createHash("sha256")
        .update(
          fs.readFileSync(new URL("../dist/datasets/" + name, import.meta.url)),
        )
        .digest("hex"),
      hash,
    );
});
test("Excel binary representation noise normalizes without rounding actual 3-decimal prices", () => {
  const raw = records();
  raw[0].销售额 = "119.12999999999999";
  const d = imported(raw);
  assert.ok(d.ok);
  assert.equal(d.rows[0].revenue, 119.13);
  assert.equal(d.report.precisionNormalized, 1);
  raw[0].销售额 = "119.125";
  assert.equal(imported(raw).ok, false);
});
test("funnel opt-in with missing columns gives explicit configuration error", () => {
  const d = imported(undefined, { strictFunnel: true });
  assert.equal(d.ok, false);
  assert.match(d.error, /四项/);
});
