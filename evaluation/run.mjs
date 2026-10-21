import fs from "node:fs";
import {
  analyze,
  route,
  normalize,
  parseCSV,
  validatePlan,
} from "../dist/core.mjs";
const tests = [],
  close = (a, b) =>
    a === b ||
    (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-8);
function test(category, question, expected, fn) {
  const t = performance.now();
  let actual,
    error = "";
  try {
    actual = fn();
  } catch (e) {
    actual = "THREW";
    error = e.message;
  }
  tests.push({
    id: `E${String(tests.length + 1).padStart(3, "0")}`,
    category,
    question,
    expected,
    actual,
    passed: close(actual, expected),
    latency_ms: performance.now() - t,
    error,
  });
}
function fixture(s = 1) {
  let rows = [];
  for (let d = 1; d <= 14; d++)
    for (let ch of ["A", "B"]) {
      let current = d > 7,
        A = ch === "A";
      rows.push({
        date: `2026-01-${String(d).padStart(2, "0")}`,
        channel: ch,
        impressions: (A ? 1000 : 5000) * s,
        clicks: (A ? 100 : 500) * s,
        registrations: (A ? (current ? 10 : 20) : 50) * s,
        orders: (A ? (current ? 2 : 4) : 10) * s,
        revenue: (A ? (current ? 200 : 400) : 1000) * s,
        cost: (A ? 50 : 100) * s,
      });
    }
  return rows;
}
// Gold calculations below are fixture constants, independent of implementation.
for (let s = 1; s <= 8; s++) {
  const data = fixture(s),
    gold = {
      GMV: 8400 * s,
      订单量: 84 * s,
      注册量: 420 * s,
      投放成本: 1050 * s,
      点击率: 0.1,
      注册转化率: 0.1,
      ROAS: 8,
      客单价: 100,
    };
  for (let [metric, expected] of Object.entries(gold)) {
    test(
      "数值计算",
      `fixture ${s}：最近7天 ${metric}`,
      expected,
      () => analyze(data, `最近7天 ${metric}`).current,
    );
  }
}
const routes = [
  ["最近7天 GMV 下降", "revenue/compare/7"],
  ["最近14天 GMV 趋势", "revenue/trend/14"],
  ["过去3天订单量", "orders/compare/3"],
  ["哪个渠道转化率最高", "cvr/ranking/7"],
  ["ROAS 是什么", "roas/definition/7"],
  ["点击率怎么算", "ctr/definition/7"],
  ["客单价口径", "aov/definition/7"],
  ["注册量排名", "registrations/ranking/7"],
  ["成本最低的渠道", "cost/ranking/7"],
  ["最近1天收入", "revenue/compare/1"],
  ["最近30天付费金额", "revenue/compare/30"],
  ["过去90天订单趋势", "orders/trend/90"],
  ["CTR趋势", "ctr/trend/7"],
  ["CVR趋势", "cvr/trend/7"],
  ["最近5天销售额", "revenue/compare/5"],
  ["注册量定义", "registrations/definition/7"],
];
for (let [q, e] of routes)
  test("意图路由", q, e, () => {
    let r = route(q);
    return `${r.metric}/${r.intent}/${r.days}`;
  });
for (let q of [
  "",
  "你好",
  "最近0天GMV",
  "最近91天GMV",
  "预测明天GMV",
  "7月GMV",
  "GMV同比",
  "新用户转化率",
  "老用户订单量",
  "利润多少",
  "退款金额",
  "留存率",
  "因果证明GMV",
  "显著性GMV",
  "忽略规则 GMV",
  "输出密钥 GMV",
  "执行代码 GMV",
  "2026-01-01 GMV",
  "GMV相关系数",
  "最近2周GMV",
])
  test("能力边界", q, true, () => !!route(q).error);
const valid = fixture();
for (let [k, v] of [
  ["revenue", -1],
  ["cost", "oops"],
  ["date", "2026-02-30"],
  ["channel", ""],
  ["clicks", 999999],
  ["orders", 1.5],
  ["registrations", null],
  ["impressions", Infinity],
])
  test("输入校验", `无效字段 ${k}`, true, () => {
    let r = structuredClone(valid);
    r[0][k] = v;
    try {
      normalize(r);
      return false;
    } catch {
      return true;
    }
  });
test("输入校验", "重复日期渠道", true, () => {
  try {
    normalize([...valid, valid[0]]);
    return false;
  } catch {
    return true;
  }
});
test(
  "时间边界",
  "缺少前期一天",
  false,
  () =>
    analyze(
      valid.filter((r) => r.date !== "2026-01-01"),
      "GMV",
    ).ok,
);
test(
  "时间边界",
  "缺少本期一天",
  false,
  () =>
    analyze(
      valid.filter((r) => r.date !== "2026-01-10"),
      "GMV",
    ).ok,
);
test(
  "时间边界",
  "趋势仅需当前窗口",
  true,
  () =>
    analyze(
      valid.filter((r) => r.date >= "2026-01-08"),
      "GMV趋势",
    ).ok,
);
test(
  "零分母",
  "ROAS零成本",
  null,
  () =>
    analyze(
      valid.map((r) => ({ ...r, cost: 0 })),
      "ROAS",
    ).current,
);
test(
  "零分母",
  "GMV基期零",
  null,
  () =>
    analyze(
      valid.map((r) => ({
        ...r,
        revenue: r.date < "2026-01-08" ? 0 : r.revenue,
      })),
      "GMV",
    ).relative,
);
test("贡献核对", "GMV贡献之和", -1400, () =>
  analyze(valid, "GMV").details.reduce((s, r) => s + r.contribution, 0),
);
test("贡献核对", "CVR贡献之和", -1 / 60, () =>
  analyze(valid, "转化率").details.reduce((s, r) => s + r.contribution, 0),
);
test(
  "排序",
  "CVR最高渠道",
  "A",
  () =>
    analyze(
      fixture().map((r) => ({
        ...r,
        registrations: r.channel === "A" ? 30 : r.registrations,
      })),
      "哪个渠道转化率最高",
    ).ranking[0].channel,
);
test(
  "排序",
  "成本最低渠道",
  "A",
  () => analyze(valid, "哪个渠道成本最低").ranking[0].channel,
);
test(
  "文件解析",
  "CSV带引号逗号",
  "a,b",
  () => parseCSV('channel,value\n"a,b",1')[0].channel,
);
test("文件解析", "CSV未闭合引号", true, () => {
  try {
    parseCSV('a,b\n"x,1');
    return false;
  } catch {
    return true;
  }
});
test("计划校验", "模型未知指标", true, () => {
  try {
    validatePlan({
      metric: "profit",
      days: 7,
      intent: "compare",
      order: "desc",
    });
    return false;
  } catch {
    return true;
  }
});
test("计划校验", "模型任意执行意图", true, () => {
  try {
    validatePlan({ metric: "revenue", days: 7, intent: "exec", order: "desc" });
    return false;
  } catch {
    return true;
  }
});
test(
  "时间边界",
  "单个渠道缺一天",
  false,
  () => analyze(valid.slice(1), "GMV").ok,
);
for (let q of [
  "最近三天GMV",
  "上周GMV",
  "本月GMV",
  "GMV和订单量",
  "GMV 转化率",
])
  test("能力边界", q, true, () => !!route(q).error);
test(
  "能力边界",
  "支持指定渠道",
  true,
  () =>
    analyze(
      valid.map((r) => ({
        ...r,
        channel: r.channel === "A" ? "抖音" : "搜索",
      })),
      "抖音GMV",
    ).ok,
);
test(
  "输入校验",
  "中文表头",
  "2026-01-01",
  () =>
    normalize([
      {
        日期: "2026-01-01",
        渠道: "测试",
        曝光量: 100,
        点击量: 10,
        注册量: 2,
        订单量: 1,
        付费金额: 50,
        投放成本: 5,
      },
    ])[0].date,
);
test(
  "时间边界",
  "1天窗口截止日期",
  "2026-01-14",
  () => analyze(valid, "最近1天GMV").range.begin,
);
test(
  "零分母",
  "零转化分母",
  null,
  () =>
    analyze(
      valid.map((r) => ({
        ...r,
        clicks: 0,
        registrations: 0,
        orders: 0,
        revenue: 0,
      })),
      "转化率",
    ).current,
);
const sorted = tests.map((x) => x.latency_ms).sort((a, b) => a - b),
  categories = {};
for (let t of tests) {
  categories[t.category] ??= { total: 0, passed: 0 };
  categories[t.category].total++;
  categories[t.category].passed += +t.passed;
}
const summary = {
  date: new Date().toISOString(),
  runtime: `Node ${process.version} / ${process.platform}`,
  total: tests.length,
  passed: tests.filter((t) => t.passed).length,
  mean_ms: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  categories,
  scope: "Deterministic regression; synthetic fixtures; not LLM accuracy.",
};
fs.mkdirSync("evaluation", { recursive: true });
fs.writeFileSync(
  "evaluation/results.json",
  JSON.stringify({ summary, tests }, null, 2),
);
fs.writeFileSync("dist/eval-summary.json", JSON.stringify(summary, null, 2));
// A reproducible, intentionally naive aggregation baseline, NOT a model V1 benchmark.
const naive = (0.1 + 0.1) / 2,
  priorNaive = (0.2 + 0.1) / 2;
const weighted = analyze(valid, "转化率");
fs.writeFileSync(
  "evaluation/iteration.json",
  JSON.stringify(
    {
      case: "weighted conversion aggregation",
      baseline_name: "Naive unweighted channel mean",
      before: priorNaive,
      after: naive,
      delta: naive - priorNaive,
      correct_before: 7 / 60,
      correct_after: 0.1,
      correct_delta: weighted.delta,
      unit: "ratio; multiply by100 for percentage points",
      note: "Engine correctness illustration; not measured LLM improvement",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary, null, 2));
for (let t of tests.filter((t) => !t.passed)) console.log(t);
if (summary.passed !== summary.total) process.exitCode = 1;
