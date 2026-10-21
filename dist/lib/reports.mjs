import { METRICS, narrative, format } from "../core.mjs";

const md = (text) =>
  String(text ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(
      /[|`<>]/g,
      (c) => ({ "|": "\\|", "`": "\\`", "<": "&lt;", ">": "&gt;" })[c],
    );
const csv = (value) => {
  let text = String(value ?? "");
  // Avoid spreadsheet formula execution in user-supplied channel names.
  if (typeof value === "string" && /^\s*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
};

export function markdownReport({ source, question, result }) {
  if (!result?.ok) throw new Error("请先完成一次有效分析");
  const lines = [
    "# OpsPilot 运营分析报告",
    "",
    `数据：${md(source)}`,
    `问题：${md(question)}`,
    "",
    "## 结论",
    "",
    md(narrative(result)),
    "",
  ];
  if (result.range)
    lines.push(
      `本期：${result.range.begin} 至 ${result.range.end}`,
      ...(result.range.prevBegin
        ? [`前期：${result.range.prevBegin} 至 ${result.range.prevEnd}`]
        : []),
      "",
    );
  if (result.data_contract)
    lines.push(
      `销售口径：${result.data_contract.revenueBasis === "paid" ? "用户声明的已支付金额" : "正向销售金额，支付状态未验证"}；声明补零记录：${result.data_contract.zeroFilled}`,
      "",
    );
  if (result.details) {
    lines.push(
      "## 渠道证据",
      "",
      `指标：${METRICS[result.plan.metric].name}（${METRICS[result.plan.metric].unit === "货币" ? result.currency : METRICS[result.plan.metric].unit}）`,
      "",
      "| 渠道 | 本期 | 前期 |",
      "| --- | ---: | ---: |",
    );
    for (const row of result.details)
      lines.push(
        `| ${md(row.channel)} | ${format(row.current, result.plan.metric, result.currency)} | ${format(row.previous, result.plan.metric, result.currency)} |`,
      );
    lines.push("", "渠道贡献仅描述变化来源，不能证明因果关系。", "");
  }
  lines.push("## 口径引用", "");
  for (const item of result.knowledge)
    lines.push(`- [${item.id}] ${md(item.title)}：${md(item.text)}`);
  if (result.ai_text)
    lines.push("", "## AI 待验证假设", "", md(result.ai_text));
  lines.push(
    "",
    "## 分析计划",
    "",
    "```json",
    JSON.stringify(result.plan, null, 2),
    "```",
    "",
  );
  return lines.join("\n");
}

export function channelCSV(result) {
  if (!result?.ok || !result.details) throw new Error("当前结果没有渠道明细");
  return (
    "\uFEFF" +
    [
      ["channel", "metric", "current", "previous", "contribution"],
      ...result.details.map((row) => [
        row.channel,
        result.plan.metric,
        row.current,
        row.previous,
        row.contribution,
      ]),
    ]
      .map((row) => row.map(csv).join(","))
      .join("\r\n")
  );
}
