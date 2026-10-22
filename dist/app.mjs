import { mountDashboard } from "./dashboard-ui.mjs";
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
import { mountImporter } from "./import-ui.mjs";
import { prepareImport, metricAvailability } from "./lib/importer.mjs";
import { route } from "./core.mjs";
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
  filename = "UCI Online Retail · 公开真实交易",
  dataset = null,
  quality = null,
  localAI = false,
  lastQuestion = "",
  feedback = [];
try {
  feedback = JSON.parse(localStorage.getItem("opspilot-feedback") || "[]");
  if (!Array.isArray(feedback)) feedback = [];
  feedback = feedback.slice(-200);
} catch {}
const dashboard = mountDashboard({ getData: () => ({ rows, dataset }), download });
const sampleText = await fetch("sample.csv").then((r) => r.text());
async function loadRealCase() {
  const text = await fetch("datasets/uci-daily-nov2011.csv").then((r) => {
    if (!r.ok) throw Error("公开案例读取失败");
    return r.text();
  });
  const imported = prepareImport(parseCSV(text), {
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
  if (!imported.ok) throw Error(imported.error);
  rows = imported.rows;
  dataset = imported.metadata;
  quality = imported.report;
  filename = "UCI Online Retail · 英国地区 · 公开真实交易";
}
try {
  await loadRealCase();
} catch (e) {
  rows = normalize(parseCSV(sampleText));
  filename = "合成示例（公开案例未能加载）";
}
function download(name, text, type = "application/json") {
  let url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function view(name) {
  $("header .export-actions").hidden = name !== "analysis";
  document.querySelectorAll(".view").forEach((e) => (e.hidden = e.id !== name));
  document
    .querySelectorAll("nav button")
    .forEach((e) => e.classList.toggle("active", e.dataset.view === name));
  $("#page-title").textContent = {
    dashboard: "经营看板 · 一眼看清业务变化",
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
  dashboard.sync();
  let dates = [...new Set(rows.map((r) => r.date))];
  $("#coverage").textContent =
    `${dates[0]} — ${dates.at(-1)} · ${rows.length} 行`;
  $("#source").textContent = filename;
  const selected = $("#channel").value;
  $("#channel").innerHTML =
    '<option value="">全部分组</option>' +
    [...new Set(rows.map((r) => r.channel))]
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
      .join("");
  if ([...new Set(rows.map((r) => r.channel))].includes(selected))
    $("#channel").value = selected;
  const available = metricAvailability(rows);
  $("#available-metrics").textContent =
    "可分析：" +
    Object.keys(available)
      .filter((m) => available[m].available)
      .map((m) => METRICS[m].name)
      .join(" / ") +
    "。未提供的字段不会补成零。";
  $("#import-report").textContent = quality
    ? JSON.stringify({ source: filename, ...quality, dataset }, null, 2)
    : "合成示例，非业务数据。";
  document.querySelectorAll("[data-q]").forEach((b) => {
    const p = route(b.dataset.q);
    b.disabled = !!(
      p.metric &&
      p.intent !== "definition" &&
      !available[p.metric]?.available
    );
    b.title = b.disabled ? "源数据缺少该指标的必要字段" : "";
  });
  const cards = Object.keys(available)
    .filter((m) => available[m].available)
    .slice(0, 4);
  $("#kpis").innerHTML = cards
    .map((m) => {
      let r = analyze(rows, `最近7天 ${METRICS[m].name}`, null, { dataset });
      return `<div class="kpi"><div class="kpi-label">${METRICS[m].name} <span class="muted">/ 最近7天</span></div><div class="kpi-value">${r.ok ? format(r.current, m, dataset?.currency) : "—"}</div><div class="change ${r.relative < 0 ? "negative" : "positive"}">${r.ok ? (r.relative == null ? "暂无可比基期" : `${r.relative < 0 ? "↓" : "↑"} ${Math.abs(r.relative * 100).toFixed(2)}%　较前7天`) : "数据不足或缺失"}</div></div>`;
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
    `${r.plan.channel || "全部分组"} · ${r.ai ? "AI 假设 + " : ""}数据计算 ${Number(r.latency_ms ?? 0).toFixed(1)} ms`;
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
  $("#chart-unit").textContent =
    METRICS[m].unit === "货币" ? r.currency : METRICS[m].unit;
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
        (METRICS[m].unit === "%"
          ? (v * 100).toFixed(2) + " pp"
          : format(v, m, r.currency));
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
        `<tr><td>${esc(d.channel)}</td><td>${format(d.current, m, r.currency)}</td><td>${r.plan.intent === "compare" ? format(d.previous, m, r.currency) : "—"}</td><td>${r.plan.intent === "compare" ? cont(d.contribution) : "—"}</td></tr>`,
    )
    .join("");
  $("#suggestion").textContent =
    r.plan.intent === "compare" && ds[0]
      ? `补充 ${ds[0].channel} 的活动与用户行为数据`
      : "按业务目标选择渠道，补充活动与用户行为数据";
}
let active = 0;
async function run() {
  const ticket = ++active;
  lastQuestion = $("#question").value;
  const selectedChannel = $("#channel").value;
  const range =
    $("#date-mode").value === "custom"
      ? { start: $("#range-start").value, end: $("#range-end").value }
      : null;
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
    if (localAI && $("#use-ai").checked) {
      let response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          question: lastQuestion,
          channel: selectedChannel || null,
          dataset,
          range,
          use_model: true,
        }),
      });
      r = await response.json();
      if (!response.ok) throw Error(r.error || "本地 AI 服务异常");
    } else
      r = analyze(rows, lastQuestion, null, {
        channel: selectedChannel || null,
        dataset,
        range,
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
      document.querySelectorAll("[data-q]").forEach((b) => {
        const p = route(b.dataset.q);
        b.disabled = !!(
          p.metric &&
          p.intent !== "definition" &&
          !metricAvailability(rows)[p.metric]?.available
        );
      });
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
async function installImport(imported) {
  ++active;
  rows = imported.rows;
  dataset = imported.metadata;
  quality = imported.report;
  filename = imported.source;
  $("#channel").value = "";
  $("#date-mode").value = "latest";
  $("#range-start").disabled = $("#range-end").disabled = true;
  $("#notice").textContent =
    localAI && $("#use-ai").checked
      ? "已接入你的业务数据。分析会把日×分组汇总发送到本地服务，AI仅接收聚合证据。"
      : "已接入你的业务数据。计算在当前浏览器完成，刷新清除；报告由你手动下载。";
  const available = metricAvailability(rows);
  const m = Object.keys(available).find((m) => available[m].available);
  $("#question").value = `${METRICS[m].name}趋势`;
  refresh();
  view("analysis");
  await run();
}
mountImporter({ onCommit: installImport, download });
$("#date-mode").onchange = () => {
  const custom = $("#date-mode").value === "custom";
  $("#range-start").disabled = $("#range-end").disabled = !custom;
  if (custom && !$("#range-end").value) {
    $("#range-end").value = rows.at(-1).date;
    $("#range-start").value = new Date(
      Date.parse(rows.at(-1).date) - 6 * 86400000,
    )
      .toISOString()
      .slice(0, 10);
  }
};
$("#download-quality").onclick = () =>
  download(
    "opspilot_data_quality.json",
    JSON.stringify({ source: filename, dataset, report: quality }, null, 2),
  );
$("#download-normalized").onclick = () => {
  const fields = [
    "date",
    "channel",
    ...Object.keys(rows[0]).filter(
      (f) =>
        !["date", "channel"].includes(f) && rows.some((r) => r[f] !== null),
    ),
  ];
  const q = (v) =>
    '"' +
    (typeof v === "string" && /^[\s]*[=+@-]/.test(v) ? "'" : "") +
    String(v ?? "").replaceAll('"', '""') +
    '"';
  download(
    "opspilot_normalized.csv",
    "\uFEFF" +
      [fields, ...rows.map((r) => fields.map((f) => r[f]))]
        .map((r) => r.map(q).join(","))
        .join("\r\n"),
    "text/csv;charset=utf-8",
  );
};
$("#real-case").onclick = async () => {
  try {
    await loadRealCase();
    await installImport({
      rows,
      metadata: dataset,
      report: quality,
      source: filename,
    });
    $("#notice").textContent =
      "公开真实交易 · 英国地区2011年11月 · GBP · 正向发票销售，支付状态未知。按全量覆盖期补齐4个无交易日。";
  } catch (e) {
    $("#notice").textContent = e.message;
  }
};
$("#sample").onclick = () =>
  download("opspilot_sample.csv", sampleText, "text/csv;charset=utf-8");
$("#reset").onclick = () => {
  rows = normalize(parseCSV(sampleText));
  dataset = null;
  quality = null;
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
  if (!result?.ok) return;
  $("#report-content").value = markdownReport({
    source: filename,
    question: lastQuestion,
    result,
  });
  $("#report-status").textContent =
    "可先核对内容，再保存。浏览器限制下载时，可复制内容保存为.md。";
  $("#report-dialog").showModal();
};
$("#report-close").onclick = () => $("#report-dialog").close();
$("#report-download").onclick = () => {
  download(
    "opspilot_report.md",
    $("#report-content").value,
    "text/markdown;charset=utf-8",
  );
  $("#report-status").textContent =
    "已请求浏览器保存文件；若未开始下载，可复制报告内容。";
};
$("#report-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("#report-content").value);
    $("#report-status").textContent = "报告已复制。";
  } catch {
    $("#report-content").focus();
    $("#report-content").select();
    $("#report-status").textContent =
      "请按Ctrl+C（Mac按Command+C）复制已选内容。";
  }
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
  ["date / 日期", "自然日或业务时间", "必需；选择YMD/DMY/MDY/Excel序号"],
  ["channel / 渠道", "渠道、门店或地区", "可选；缺省为全部业务"],
  ["impressions / 曝光量", "漏斗曝光次数", "可选；非负整数"],
  ["clicks / 点击量", "漏斗点击次数", "可选；同口径漏斗才校验"],
  [
    "registrations / 注册量",
    "由点击转化的注册量",
    "可选；未提供不能算注册转化",
  ],
  ["orders / 订单量", "同口径漏斗成交订单", "日汇总可选；订单明细按唯一ID计数"],
  [
    "revenue / 付费金额",
    "所选单一币种的销售金额",
    "选择正向销售或已支付口径；不等于净收入",
  ],
  ["cost / 投放成本", "同分组投放成本，所选币种", "可选；缺失不能算ROAS"],
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
{
  try {
    let c = await fetch("/api/config").then((r) => r.json());
    localAI = c.ai;
    if (localAI) {
      $("#use-ai").disabled = false;
      $("#mode").textContent = "AI + 数据工具";
      $("#notice").textContent =
        "模型已配置，默认未启用。勾选授权后才发送聚合证据。";
    }
  } catch {}
}
if (dataset)
  $("#notice").textContent =
    "公开真实交易 · 英国地区2011年11月 · GBP · 正向发票销售，支付状态未知。按全量覆盖期补齐4个无交易日。数据在当前浏览器计算。";
$("#use-ai").onchange = () => {
  $("#notice").textContent = $("#use-ai").checked
    ? "AI已启用：问题、分组和聚合结果将发送到你配置的模型端点。请确认有权分享这些业务信息。"
    : "AI未启用；数据只在当前浏览器计算。";
};
refresh();
await run();
view("dashboard");
