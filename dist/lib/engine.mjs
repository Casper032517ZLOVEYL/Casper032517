import { METRICS, COLUMNS, retrieve } from "./catalog.mjs";
import { normalize } from "./data.mjs";
import { route, validatePlan } from "./router.mjs";

const sum = (rows, key) => {
  if (rows.some((r) => !Number.isFinite(r[key]))) return null;
  const money = ["revenue", "cost"].includes(key);
  if (
    money &&
    rows.every((r) => Math.abs(r[key] * 100 - Math.round(r[key] * 100)) < 0.001)
  ) {
    const cents = rows.reduce(
      (total, r) => total + Math.round(r[key] * 100),
      0,
    );
    if (!Number.isSafeInteger(cents))
      throw Error("金额合计超出安全精度，请缩小数据范围");
    return cents / 100;
  }
  const total = rows.reduce((n, r) => n + r[key], 0);
  if (!money && !Number.isSafeInteger(total))
    throw Error("计数合计超出安全精度，请缩小数据范围");
  return total;
};
const addDays = (date, days) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const aggregate = (rows) =>
  Object.fromEntries(COLUMNS.slice(2).map((key) => [key, sum(rows, key)]));

export function value(rows, metric) {
  const item = METRICS[metric];
  if (!item) throw new Error("未知指标");
  const numerator = sum(rows, item.a);
  if (numerator === null || (item.b && sum(rows, item.b) === null)) return null;
  return item.b
    ? sum(rows, item.b)
      ? numerator / sum(rows, item.b)
      : null
    : numerator;
}

export function analyze(input, question, override = null, options = {}) {
  const started = performance.now();
  try {
    if (typeof question !== "string")
      return { ok: false, error: "问题必须是文本。" };
    // Resolve channel scope before parsing to avoid metric words in channel names.
    const rawChannels = Array.isArray(input)
      ? [
          ...new Set(
            input
              .map((r) => r?.channel ?? r?.渠道)
              .filter((c) => typeof c === "string"),
          ),
        ]
      : [];
    const mentioned = rawChannels.filter((channel) => {
      if (/^[a-z0-9]$/i.test(channel))
        return new RegExp(`(^|[^a-z0-9])${channel}([^a-z0-9]|$)`, "i").test(
          question,
        );
      return question.includes(channel);
    });
    const routedQuestion = mentioned.reduce(
      (q, c) => q.split(c).join(""),
      question,
    );
    const parsed = route(routedQuestion);
    if (parsed.error) return { ok: false, error: parsed.error };
    let plan = validatePlan(override || parsed);
    if (
      override &&
      ["metric", "days", "intent", "order"].some(
        (key) => plan[key] !== parsed[key],
      )
    )
      return { ok: false, error: "分析计划改变了问题范围，已拒绝执行。" };
    if (mentioned.length > 1)
      return {
        ok: false,
        error: "请一次指定一个渠道，或使用“哪个渠道”比较全部渠道。",
      };
    const requested = options.channel || mentioned[0] || plan.channel;
    if (
      (options.channel && mentioned[0] && options.channel !== mentioned[0]) ||
      (plan.channel && requested !== plan.channel)
    )
      return { ok: false, error: "问题与渠道筛选不一致，请确认渠道。" };
    if (requested) plan = { ...plan, channel: requested };
    const knowledge = retrieve(question);
    if (plan.intent === "definition")
      return {
        ok: true,
        plan,
        knowledge,
        definition: `${METRICS[plan.metric].name} = Σ${METRICS[plan.metric].a}${METRICS[plan.metric].b ? " / Σ" + METRICS[plan.metric].b : ""}`,
        latency_ms: performance.now() - started,
      };
    const dataset = options.dataset;
    if (
      dataset &&
      (dataset.version !== 1 ||
        !["CNY", "GBP", "USD", "EUR", "JPY", "HKD"].includes(
          dataset.currency,
        ) ||
        !["gross", "paid"].includes(dataset.revenueBasis))
    )
      return { ok: false, error: "数据口径配置无效，请重新导入。" };
    const rows = normalize(
      input,
      dataset
        ? { partial: true, strictFunnel: dataset.strictFunnel === true }
        : {},
    );
    if (plan.channel && !rows.some((r) => r.channel === plan.channel))
      return { ok: false, error: `数据中没有渠道：${plan.channel}` };
    let end = rows.at(-1).date;
    if (options.range) {
      const { start, end: until } = options.range;
      const validDate = (d) =>
        typeof d === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(d) &&
        Number.isFinite(Date.parse(d)) &&
        new Date(d).toISOString().slice(0, 10) === d;
      if (!validDate(start) || !validDate(until))
        return { ok: false, error: "日期范围无效。" };
      const days = (Date.parse(until) - Date.parse(start)) / 86400000 + 1;
      if (days < 1 || days > 90)
        return { ok: false, error: "分析范围须为1–90天。" };
      const explicitDays = routedQuestion.match(
        /(?:最近|近|过去)?\s*(\d+)\s*[天日]/,
      );
      if (explicitDays && Number(explicitDays[1]) !== days)
        return {
          ok: false,
          error: "问题中的天数与自选日期范围不一致，请修改问题或日期。",
        };
      if (/最近一周/.test(routedQuestion) && days !== 7)
        return { ok: false, error: "最近一周与自选日期范围不一致。" };
      plan = { ...plan, days };
      end = until;
    }
    const begin = addDays(end, 1 - plan.days),
      prevEnd = addDays(begin, -1),
      prevBegin = addDays(begin, -plan.days);
    const scoped = plan.channel
      ? rows.filter((row) => row.channel === plan.channel)
      : rows;
    const current = scoped.filter(
      (row) => row.date >= begin && row.date <= end,
    );
    const previous = scoped.filter(
      (row) => row.date >= prevBegin && row.date <= prevEnd,
    );
    const comparison = plan.intent === "compare";
    const relevant = comparison ? [...previous, ...current] : current;
    const channels = plan.channel
      ? [plan.channel]
      : [...new Set(relevant.map((row) => row.channel))];
    if (!channels.length) return { ok: false, error: "所选窗口没有数据。" };
    const required = [METRICS[plan.metric].a, METRICS[plan.metric].b].filter(
      Boolean,
    );
    const missing = required.filter((f) => relevant.some((r) => r[f] === null));
    if (missing.length)
      return {
        ok: false,
        error: `当前数据缺少 ${missing.join("、")}，不能计算${METRICS[plan.metric].name}。请补充字段或改选可用指标；未将缺失值填零。`,
      };
    const keys = new Set(
      relevant.map((row) => JSON.stringify([row.date, row.channel])),
    );
    for (
      let day = comparison ? prevBegin : begin;
      day <= end;
      day = addDays(day, 1)
    ) {
      for (const channel of channels)
        if (!keys.has(JSON.stringify([day, channel])))
          return {
            ok: false,
            error: `缺少 ${day} / ${channel} 的记录。无业务请显式填写零值，不能把缺失当作零。`,
          };
    }
    const metric = plan.metric,
      definition = METRICS[metric];
    const currentValue = value(current, metric),
      previousValue = comparison ? value(previous, metric) : null;
    const delta =
      currentValue === null || previousValue === null
        ? null
        : currentValue - previousValue;
    const relative =
      delta === null || previousValue === 0 ? null : delta / previousValue;
    const currentDenominator = definition.b ? sum(current, definition.b) : null;
    const previousDenominator = definition.b
      ? sum(previous, definition.b)
      : null;
    const details = channels.map((channel) => {
      const cr = current.filter((row) => row.channel === channel),
        pr = previous.filter((row) => row.channel === channel);
      const cv = value(cr, metric),
        pv = comparison ? value(pr, metric) : null;
      const contribution = !comparison
        ? null
        : definition.b
          ? currentDenominator && previousDenominator
            ? sum(cr, definition.a) / currentDenominator -
              sum(pr, definition.a) / previousDenominator
            : null
          : sum(cr, definition.a) - sum(pr, definition.a);
      return {
        channel,
        current: cv,
        previous: pv,
        delta: cv === null || pv === null ? null : cv - pv,
        numerator: sum(cr, definition.a),
        denominator: definition.b ? sum(cr, definition.b) : null,
        contribution,
      };
    });
    const ranking = details
      .filter((row) => row.current !== null)
      .sort(
        (a, b) =>
          (plan.order === "asc" ? 1 : -1) * (a.current - b.current) ||
          a.channel.localeCompare(b.channel),
      );
    const daily = new Map();
    for (const row of current) {
      if (!daily.has(row.date)) daily.set(row.date, []);
      daily.get(row.date).push(row);
    }
    const trend = [...daily]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayRows]) => ({ date, value: value(dayRows, metric) }));
    return {
      ok: true,
      currency: dataset?.currency || "CNY",
      data_contract: dataset
        ? {
            revenueBasis: dataset.revenueBasis,
            zeroFilled: dataset.zeroFilled || 0,
            mode: dataset.mode || "daily",
          }
        : null,
      plan,
      knowledge,
      range: { begin, end, ...(comparison ? { prevBegin, prevEnd } : {}) },
      current: currentValue,
      previous: previousValue,
      delta,
      relative,
      details,
      ranking,
      trend,
      anomaly: relative === null ? null : Math.abs(relative) >= 0.1,
      evidence: {
        current: aggregate(current),
        previous: comparison ? aggregate(previous) : null,
      },
      formula: `Σ${definition.a}${definition.b ? " / Σ" + definition.b : ""}`,
      rows: current.length,
      latency_ms: performance.now() - started,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function format(number, metric, currency = "CNY") {
  if (number === null || number === undefined) return "不可计算";
  const definition = METRICS[metric];
  return definition.unit === "%"
    ? (number * 100).toFixed(2) + "%"
    : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(
        number,
      ) +
        (definition.unit === "倍"
          ? "×"
          : ["revenue", "cost", "aov"].includes(metric)
            ? ` ${currency}`
            : "");
}

export function narrative(result) {
  if (!result.ok) return result.error;
  if (result.definition) return result.definition;
  const metric = result.plan.metric,
    name = METRICS[metric].name,
    scope = result.plan.channel ? `渠道 ${result.plan.channel}，` : "";
  if (result.plan.intent === "ranking") {
    if (!result.ranking.length)
      return "所选窗口所有渠道的分母均为零，没有可计算的排名。";
    return `${result.range.begin} 至 ${result.range.end}，${scope}${name}${result.plan.order === "asc" ? "最低" : "最高"}的渠道是 ${result.ranking[0].channel}，${format(result.ranking[0].current, metric, result.currency)}。`;
  }
  if (result.plan.intent === "trend")
    return `${result.range.begin} 至 ${result.range.end}，${scope}已汇总 ${result.plan.days} 天${name}；窗口指标为 ${format(result.current, metric, result.currency)}。空值代表分母为零。`;
  return (
    `${result.range.begin} 至 ${result.range.end}，${scope}${name}为 ${format(result.current, metric, result.currency)}，前一等长窗口为 ${format(result.previous, metric, result.currency)}。` +
    (result.relative === null
      ? "基期为零或分母无效，不计算相对变化。"
      : `相对${result.relative < 0 ? "下降" : "上升"} ${(Math.abs(result.relative) * 100).toFixed(2)}%。`) +
    (METRICS[metric].unit === "%" && result.delta !== null
      ? `变化 ${(result.delta * 100).toFixed(2)} 个百分点。`
      : "")
  );
}
