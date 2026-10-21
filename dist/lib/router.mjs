import { METRICS } from "./catalog.mjs";

const PATTERNS = [
  ["cvr", /注册转化率|转化率|转化|cvr/gi],
  ["ctr", /点击率|ctr/gi],
  ["roas", /roas|投放回报|回报/gi],
  ["aov", /客单价|客单|aov/gi],
  ["revenue", /gmv|营收|收入|付费金额|销售额|金额/gi],
  ["orders", /订单量|订单/gi],
  ["registrations", /注册量|注册/gi],
  ["cost", /投放成本|成本|花费/gi],
];

/** Intentionally bounded language support; ambiguity is surfaced to the user. */
export function route(question) {
  if (typeof question !== "string" || !question.trim() || question.length > 500)
    return { error: "请输入 1–500 字的问题。" };
  const q = question.trim().toLowerCase();
  if (/忽略|system|执行代码|删除|密钥|密码|eval\(|import |rm -|__/.test(q))
    return { error: "该请求不属于只读运营分析范围。" };
  if (
    /留存|新用户|老用户|利润|退款|同比|预测|明天|因果|显著|相关系数|中位数|[0-9一二三四五六七八九十]+月|\d{4}[-/]|[0-9一二三四五六七八九十]+周|[一二三四五六七八九十]+天|上周|本周|昨天|今天|本月|上月|全年|排除|分别|同时|和|以及/.test(
      q.replace(/(?:最近|近|过去)一周/g, "最近7天"),
    )
  ) {
    return {
      error:
        "请一次分析一个指标。指定日期、同比、用户分群、因果与预测需更多数据和工具。",
    };
  }
  let rest = q;
  const matched = [];
  for (const [metric, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(rest)) {
      matched.push(metric);
      rest = rest.replace(pattern, "");
    }
  }
  if (matched.length !== 1)
    return {
      error: matched.length
        ? "识别到多个指标，请一次查询一个指标。"
        : "请指定指标，例如“最近7天 GMV 为什么下降？”",
    };
  const normalized = q.replace(/(?:最近|近|过去)一周/g, "最近7天");
  const explicit = [
    ...normalized.matchAll(/(?:最近|近|过去)?\s*(\d+)\s*(?:天|日)/g),
  ].map((match) => Number(match[1]));
  if (new Set(explicit).size > 1)
    return { error: "识别到多个时间窗口，请一次指定一个窗口。" };
  const days = explicit[0] ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 90)
    return { error: "分析窗口支持 1–90 天。" };
  const intent = /定义|怎么算|口径|是什么/.test(q)
    ? "definition"
    : /排名|最高|最低|哪个|排序/.test(q)
      ? "ranking"
      : /趋势|每天|每日/.test(q)
        ? "trend"
        : "compare";
  return {
    metric: matched[0],
    days,
    intent,
    order: /最低|最少|从低到高/.test(q) ? "asc" : "desc",
  };
}

export function validatePlan(plan) {
  const allowed = ["metric", "days", "intent", "order", "channel"];
  if (
    !plan ||
    Object.keys(plan).some((key) => !allowed.includes(key)) ||
    !Object.hasOwn(METRICS, plan.metric) ||
    !["definition", "ranking", "trend", "compare"].includes(plan.intent) ||
    !Number.isInteger(plan.days) ||
    plan.days < 1 ||
    plan.days > 90 ||
    !["asc", "desc"].includes(plan.order) ||
    (plan.channel !== undefined &&
      plan.channel !== null &&
      (typeof plan.channel !== "string" || !plan.channel.trim()))
  ) {
    throw new Error("分析计划不在允许范围内");
  }
  return {
    metric: plan.metric,
    days: plan.days,
    intent: plan.intent,
    order: plan.order,
    ...(plan.channel ? { channel: plan.channel } : {}),
  };
}
