import test from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  normalize,
  parseCSV,
  route,
  validatePlan,
  narrative,
} from "../dist/core.mjs";
import { markdownReport, channelCSV } from "../dist/lib/reports.mjs";

function fixture() {
  const rows = [];
  for (let day = 1; day <= 14; day++) {
    for (const channel of ["抖音", "搜索"])
      rows.push({
        date: `2026-01-${String(day).padStart(2, "0")}`,
        channel,
        impressions: 1000,
        clicks: 100,
        registrations: 20,
        orders: 5,
        revenue: channel === "抖音" ? (day > 7 ? 400 : 500) : 600,
        cost: 50,
      });
  }
  return rows;
}

test("spoken latest-week maps to an explicit 7-day plan", () => {
  assert.equal(route("最近一周GMV").days, 7);
});
test("never silently select one of two metrics", () => {
  assert.ok(route("GMV 转化率").error);
});
test("ambiguous time windows require clarification", () => {
  assert.ok(route("最近7天GMV对比最近30天").error);
});
test("channel in natural language is scoped, not ignored", () => {
  const result = analyze(fixture(), "抖音最近7天GMV");
  assert.equal(result.plan.channel, "抖音");
  assert.equal(result.current, 2800);
  assert.equal(result.previous, 3500);
});
test("channel selector uses same numerical contract as language", () => {
  const result = analyze(fixture(), "最近7天GMV", null, { channel: "抖音" });
  assert.equal(result.current, 2800);
});
test("selector and question must agree", () => {
  assert.equal(
    analyze(fixture(), "抖音GMV", null, { channel: "搜索" }).ok,
    false,
  );
});
test("multiple named channels require clarification", () => {
  assert.equal(analyze(fixture(), "抖音 搜索 GMV").ok, false);
});
test("unknown channel rejects instead of falling back to total", () => {
  assert.equal(
    analyze(fixture(), "GMV", null, { channel: "不存在" }).ok,
    false,
  );
});
test("filtered range is anchored to full dataset, never to stale channel data", () => {
  const data = fixture().filter(
    (r) => !(r.channel === "抖音" && r.date === "2026-01-14"),
  );
  assert.equal(analyze(data, "抖音GMV").ok, false);
});
test("trend needs only current window and exposes no partial prior", () => {
  const result = analyze(
    fixture().filter((r) => r.date >= "2026-01-08"),
    "GMV趋势",
  );
  assert.equal(result.ok, true);
  assert.equal(result.previous, null);
  assert.equal(result.range.prevBegin, undefined);
  assert.ok(
    result.details.every((r) => r.previous === null && r.contribution === null),
  );
});
test("all zero denominators yield no ranked winner", () => {
  const result = analyze(
    fixture().map((r) => ({ ...r, cost: 0 })),
    "哪个渠道ROAS最高",
  );
  assert.equal(result.ranking.length, 0);
  assert.match(narrative(result), /没有可计算/);
});
test("unsafe plan fields are rejected", () => {
  assert.throws(() =>
    validatePlan({
      metric: "revenue",
      days: 7,
      intent: "compare",
      order: "desc",
      code: "malicious",
    }),
  );
});
test("override cannot change validated user intent", () => {
  assert.equal(
    analyze(fixture(), "GMV", {
      metric: "cost",
      days: 7,
      intent: "compare",
      order: "desc",
    }).ok,
    false,
  );
});
test("boolean is not a valid business count", () => {
  const data = fixture();
  data[0].orders = true;
  assert.throws(() => normalize(data));
});
test("array row is not a valid record", () => {
  assert.throws(() => normalize([[]]));
});
test("empty CSV header is rejected", () => {
  assert.throws(() => parseCSV("a,,c\n1,2,3"));
});
test("CSV escaped quotes and line breaks round-trip", () => {
  assert.equal(
    parseCSV('a,b\n"first\nsecond","say ""yes"""')[0].b,
    'say "yes"',
  );
});
test("numeric exponent string is rejected by decimal schema", () => {
  const data = fixture();
  data[0].revenue = "1e3";
  assert.throws(() => normalize(data));
});
test("Markdown report preserves measured values and references", () => {
  const result = analyze(fixture(), "最近7天GMV为什么下降");
  const report = markdownReport({
    source: "合成数据",
    question: "GMV为什么下降",
    result,
  });
  assert.match(report, /7,000/);
  assert.match(report, /K03/);
  assert.match(report, /不能证明因果/);
});
test("Markdown report escapes table separators from channel names", () => {
  const result = analyze(
    fixture().map((r) => ({
      ...r,
      channel: r.channel === "抖音" ? "a|b" : r.channel,
    })),
    "GMV",
  );
  assert.ok(
    markdownReport({ source: "s", question: "q", result }).includes("a\\|b"),
  );
});
test("CSV export prevents formulas in untrusted labels", () => {
  const result = analyze(
    fixture().map((r) => ({
      ...r,
      channel: r.channel === "抖音" ? '=HYPERLINK("x")' : r.channel,
    })),
    "GMV",
  );
  assert.ok(channelCSV(result).includes("'=HYPERLINK"));
});
test("failed analysis cannot be exported as a report", () => {
  assert.throws(() => markdownReport({ result: { ok: false } }));
});
test("sum contributions reconcile to overall change", () => {
  const result = analyze(fixture(), "GMV");
  assert.equal(
    result.details.reduce((total, r) => total + r.contribution, 0),
    result.delta,
  );
});
test("safely reject non-text question", () => {
  assert.equal(analyze(fixture(), null).ok, false);
});
