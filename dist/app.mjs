import { chart } from "./lib/charts.mjs";
import { markdownReport, channelCSV } from "./lib/reports.mjs";
import {
  analyze,
  normalize,
  parseCSV,
  format,
  narrative,
  METRICS,
} from "./core.mjs";
import { readXlsx } from "./xlsx.mjs";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let rows = [],
  result = null,
  filename = "示例运营数据 · 合成",
  localAI = false,
  lastQuestion = "",
  feedback = [];
try {
  feedback = JSON.parse(localStorage.getItem("opspilot-feedback") || "[]");
  if (!Array.isArray(feedback)) feedback = [];
  feedback = feedback.slice(-200);
} catch {}
const sampleText = await fetch("sample.csv").then((r) => r.text());
rows = normalize(parseCSV(sampleText));
function download(name, text, type = "application/json") {
  let url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function view(name) {
  document.querySelectorAll(".view").forEach((e) => (e.hidden = e.id !== name));
  document
    .querySelectorAll("nav button")
    .forEach((e) => e.classList.toggle("active", e.dataset.view === name));
  $("#page-title").textContent = {
    analysis: "让运营判断有据可依",
    data: "数据与指标口径",
    evaluation: "每一次迭代，都可验证",
    guide: "一个完整的 AI 产品实践",
  }[name];
}
document
  .querySelectorAll("nav button")
  .forEach((b) => (b.onclick = () => view(b.dataset.view)));
function refresh() {
  let dates = [...new Set(rows.map((r) => r.date))];
  $("#coverage").textContent =
    `${dates[0]} — ${dates.at(-1)} · ${rows.length} 行`;
  $("#source").textContent = filename;
  const selected = $("#channel").value;
  $("#channel").innerHTML =
    '<option value="">全部渠道</option>' +
    [...new Set(rows.map((r) => r.channel))]
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
      .join("");
  if ([...new Set(rows.map((r) => r.channel))].includes(selected))
    $("#channel").value = selected;
  $("#kpis").innerHTML = ["revenue", "orders", "cvr", "roas"]
    .map((m) => {
      let r = analyze(rows, `最近7天 ${METRICS[m].name}`);
      return `<div class="kpi"><div class="kpi-label">${METRICS[m].name} <span class="muted">/ 最近7天</span></div><div class="kpi-value">${r.ok ? format(r.current, m) : "—"}</div><div class="change ${r.relative < 0 ? "negative" : "positive"}">${r.ok ? (r.relative == null ? "暂无可比基期" : `${r.relative < 0 ? "↓" : "↑"} ${Math.abs(r.relative * 100).toFixed(2)}%　较前7天`) : "数据不足或缺失"}</div></div>`;
    })
    .join("");
  let keys = Object.keys(rows[0]);
  $("#preview").innerHTML =
    "<caption>数据预览 · 前 8 行</caption><thead><tr>" +
    keys.map((k) => "<th>" + esc(k) + "</th>").join("") +
    "</tr></thead><tbody>" +
    rows
      .slice(0, 8)
      .map(
        (r) =>
          "<tr>" +
          keys.map((k) => "<td>" + esc(r[k]) + "</td>").join("") +
          "</tr>",
      )
      .join("") +
    "</tbody>";
}
function render(r) {
  $("#error").hidden = r.ok;
  $("#result").hidden = !r.ok;
  if (!r.ok) {
    $("#error").textContent = r.error;
    return;
  }
  const m = r.plan.metric;
  $("#result .details").hidden = !!r.definition;
  $("#result .bottom-grid article:first-child").hidden = !!r.definition;
  $("#caveat").hidden = !!r.definition;
  $("#trace").textContent =
    `${r.plan.channel || "全部渠道"} · ${r.ai ? "AI 假设 + " : ""}数据计算 ${Number(r.latency_ms ?? 0).toFixed(1)} ms`;
  $("#alert-state").hidden = r.anomaly !== true;
  $("#usage").hidden = !r.total_latency_ms;
  if (r.total_latency_ms)
    $("#usage").textContent =
      `端到端 ${r.total_latency_ms.toFixed(0)} ms · Token ${r.usage ? r.usage.prompt_tokens + r.usage.completion_tokens : "未提供"} · 费用 ${r.cost_usd == null ? "未配置或无用量" : "$" + r.cost_usd.toFixed(6)}`;
  $("#summary").textContent = narrative(r);
  $("#result-title").textContent = r.definition
    ? "指标口径"
    : r.plan.intent === "ranking"
      ? `${METRICS[m].name}渠道排名`
      : r.plan.intent === "trend"
        ? `${METRICS[m].name}逐日趋势`
        : `${METRICS[m].name}${r.delta === null ? "暂无可比值" : r.delta < 0 ? "有所下降" : r.delta > 0 ? "有所增长" : "保持不变"}`;
  $("#plan").textContent = JSON.stringify(
    { ...r.plan, range: r.range, formula: r.formula, rows: r.rows },
    null,
    2,
  );
  $("#knowledge").innerHTML = r.knowledge.length
    ? r.knowledge
        .map(
          (k) =>
            `<div class="citation"><b>[${esc(k.id)}] ${esc(k.title)}</b><br>${esc(k.text)}</div>`,
        )
        .join("")
    : '<p class="muted">未匹配到知识条目；请直接核对计算公式。</p>';
  $("#contribution").innerHTML = "";
  $("#chart").innerHTML = "";
  $("#details").innerHTML = "";
  $("#formula").textContent = r.formula || r.definition;
  $("#chart-title").textContent = r.definition
    ? "计算口径"
    : r.plan.intent === "ranking"
      ? "渠道对比"
      : "每日趋势";
  $("#chart-unit").textContent = METRICS[m].unit;
  $("#chart-caption").textContent = r.range
    ? `${r.range.begin} — ${r.range.end}`
    : "不需要运行数据计算";
  $("#ai-note").hidden = !r.ai_text;
  if (r.ai_text)
    $("#ai-note").textContent =
      (r.ai_status === "fallback" ? "AI 状态：" : "AI 假设（待验证）：") +
      r.ai_text;
  if (r.definition) {
    $("#chart").innerHTML = '<p class="muted">' + esc(r.definition) + "</p>";
    return;
  }
  $("#chart").innerHTML = chart(r);
  const ds = [...r.details].sort(
      (a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0),
    ),
    max = Math.max(...ds.map((x) => Math.abs(x.contribution ?? 0)), 0.00001);
  const cont = (v) =>
    v === null
      ? "不可计算"
      : (v > 0 ? "+" : "") +
        (METRICS[m].unit === "%" ? (v * 100).toFixed(2) + " pp" : format(v, m));
  $("#contribution").innerHTML =
    r.plan.intent === "compare"
      ? ds
          .slice(0, 4)
          .map(
            (d) =>
              `<div class="contribution-row"><span>${esc(d.channel)}</span><div class="bar-track"><i style="width:${(Math.abs(d.contribution ?? 0) / max) * 100}%;background:${d.contribution < 0 ? "#e6a0a4" : "#70bfb7"}"></i></div><span style="text-align:right">${esc(cont(d.contribution))}</span></div>`,
          )
          .join("")
      : "";
  $("#caveat").textContent =
    r.plan.intent === "compare"
      ? METRICS[m].b
        ? "比率贡献 = 渠道本期分子 / 全部本期分母 − 渠道前期分子 / 全部前期分母；包含分母结构变化，不等于渠道自身变化。"
        : "渠道变化贡献之和等于整体变化；这是描述性分解，不能证明因果关系。"
      : "比率按汇总分子 / 汇总分母计算；没有有效分母时不参与排名。";
  $("#details").innerHTML = (
    r.plan.intent === "ranking" ? r.ranking : r.details
  )
    .map(
      (d) =>
        `<tr><td>${esc(d.channel)}</td><td>${format(d.current, m)}</td><td>${r.plan.intent === "compare" ? format(d.previous, m) : "—"}</td><td>${r.plan.intent === "compare" ? cont(d.contribution) : "—"}</td></tr>`,
    )
    .join("");
  $("#suggestion").textContent = r.plan.intent === "compare" && ds[0]
    ? `补充 ${ds[0].channel} 的活动与用户行为数据`
    : "按业务目标选择渠道，补充活动与用户行为数据";
}
let active = 0;
async function run() {
  const ticket = ++active;
  lastQuestion = $("#question").value;
  const selectedChannel = $("#channel").value;
  result = null;
  $("#export").disabled = true;
  $("#export-json").disabled = true;
  $("#channel-csv").disabled = true;
  document.querySelectorAll("[data-q]").forEach((b) => (b.disabled = true));
  $("#channel").disabled = true;
  $("#submit").disabled = true;
  $("#submit").textContent = "分析中…";
  try {
    let r;
    if (localAI) {
      let response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          question: lastQuestion,
          channel: selectedChannel || null,
        }),
      });
      r = await response.json();
      if (!response.ok) throw Error(r.error || "本地 AI 服务异常");
    } else
      r = analyze(rows, lastQuestion, null, {
        channel: selectedChannel || null,
      });
    if (ticket === active) {
      result = r;
      render(r);
    }
  } catch (e) {
    if (ticket === active) {
      result = { ok: false, error: "分析失败：" + e.message };
      render(result);
    }
  } finally {
    if (ticket === active) {
      $("#submit").disabled = false;
      $("#submit").textContent = "开始分析 ↗";
      $("#channel").disabled = false;
      document
        .querySelectorAll("[data-q]")
        .forEach((b) => (b.disabled = false));
      $("#export").disabled = !result?.ok;
      $("#export-json").disabled = !result?.ok;
      $("#channel-csv").disabled = !result?.details;
    }
  }
}
$("#ask-form").onsubmit = (e) => {
  e.preventDefault();
  run();
};
document.querySelectorAll("[data-q]").forEach(
  (b) =>
    (b.onclick = () => {
      $("#question").value = b.dataset.q;
      run();
    }),
);
$("#choose").onclick = $("#upload2").onclick = () => $("#file").click();
$("#file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (!/\.(csv|xlsx)$/i.test(file.name))
      throw Error("仅支持 .csv 和 .xlsx 文件");
    if (file.size > 5 * 1024 * 1024) throw Error("文件超过 5 MB");
    const parsed = file.name.toLowerCase().endsWith(".xlsx")
      ? await readXlsx(await file.arrayBuffer())
      : parseCSV(await file.text());
    rows = normalize(parsed);
    filename = file.name;
    $("#channel").value = "";
    $("#notice").textContent = localAI
      ? "已加载你的数据。AI 模式会将渠道聚合概况、问题与计算证据发送到配置的模型服务。"
      : "已加载你的数据。数据仅在当前浏览器内计算，刷新后清除。";
    refresh();
    view("analysis");
    await run();
  } catch (e) {
    $("#error").hidden = false;
    $("#error").textContent = "导入未完成：" + e.message;
    view("analysis");
  } finally {
    $("#file").value = "";
  }
};
$("#sample").onclick = () =>
  download("opspilot_sample.csv", sampleText, "text/csv;charset=utf-8");
$("#reset").onclick = () => {
  rows = normalize(parseCSV(sampleText));
  filename = "示例运营数据 · 合成";
  $("#channel").value = "";
  $("#notice").textContent = "演示数据 · 合成电商漏斗，非真实业务结果。";
  refresh();
  run();
  view("analysis");
};
$("#export-json").onclick = () => {
  if (!result?.ok) {
    alert("请先完成一次有效分析");
    return;
  }
  download(
    "opspilot_analysis.json",
    JSON.stringify(
      {
        source: filename,
        question: lastQuestion,
        generated_at: new Date().toISOString(),
        result,
      },
      null,
      2,
    ),
  );
};
$("#export").onclick = () => {
  if (result?.ok)
    download(
      "opspilot_report.md",
      markdownReport({ source: filename, question: lastQuestion, result }),
      "text/markdown;charset=utf-8",
    );
};
$("#channel-csv").onclick = () => {
  if (result?.details)
    download(
      "opspilot_channels.csv",
      channelCSV(result),
      "text/csv;charset=utf-8",
    );
};
$("#channel").onchange = () => run();
document.querySelectorAll("[data-feedback]").forEach(
  (b) =>
    (b.onclick = () => {
      if (!result?.ok) return;
      feedback.push({
        time: new Date().toISOString(),
        question: lastQuestion,
        plan: result?.plan,
        rating: b.dataset.feedback,
        request_id: result?.request_id || null,
      });
      feedback = feedback.slice(-200);
      try {
        localStorage.setItem("opspilot-feedback", JSON.stringify(feedback));
        $("#feedback-status").textContent = "已记录反馈，可导出复盘。";
      } catch {
        $("#feedback-status").textContent =
          "浏览器存储不可用，请导出本次反馈。";
      }
    }),
);
$("#feedback-export").onclick = () =>
  download("opspilot_feedback.json", JSON.stringify(feedback, null, 2));
$("#schema").innerHTML = [
  ["date / 日期", "自然日", "YYYY-MM-DD"],
  ["channel / 渠道", "渠道名称", "与日期组成唯一键"],
  ["impressions / 曝光量", "漏斗曝光次数", "非负整数"],
  ["clicks / 点击量", "漏斗点击次数", "不超过曝光量"],
  ["registrations / 注册量", "由点击转化的注册量", "不超过点击量"],
  ["orders / 订单量", "同口径漏斗成交订单", "不超过注册量"],
  ["revenue / 付费金额", "已支付订单金额，人民币", "非负数，不含净收入定义"],
  ["cost / 投放成本", "同渠道投放成本，人民币", "非负数"],
]
  .map((r) => "<tr>" + r.map((x) => "<td>" + x + "</td>").join("") + "</tr>")
  .join("");
try {
  let e = await fetch("eval-summary.json").then((r) => r.json());
  $("#eval-kpis").innerHTML = [
    ["回归用例", e.total],
    ["通过数量", e.passed],
    ["通过率", ((e.passed / e.total) * 100).toFixed(1) + "%"],
    ["工具 P95", e.p95_ms.toFixed(2) + " ms"],
  ]
    .map(
      ([k, v]) =>
        `<div class="kpi"><div class="kpi-label">${k}</div><div class="kpi-value">${v}</div></div>`,
    )
    .join("");
  $("#eval-info").textContent =
    `运行日期：${e.date}。环境：${e.runtime}。延迟仅覆盖单次工具计算，不含网络或模型。`;
  $("#eval-table").innerHTML = Object.entries(e.categories)
    .map(
      ([k, v]) =>
        `<tr><td>${esc(k)}</td><td>${v.total}</td><td>${v.passed}</td></tr>`,
    )
    .join("");
} catch {
  $("#eval-info").textContent = "评测记录尚未加载。";
}
if (["localhost", "127.0.0.1", "terminal.local"].includes(location.hostname)) {
  try {
    let c = await fetch("/api/config").then((r) => r.json());
    localAI = c.ai;
    if (localAI) {
      $("#mode").textContent = "AI + 数据工具";
      $("#notice").textContent =
        "本地 AI 模式 · 问题、渠道概况和计算证据会发送到配置的模型服务。示例数据为合成。";
    }
  } catch {}
}
refresh();
await run();
