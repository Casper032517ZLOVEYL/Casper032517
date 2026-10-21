import { parseCSV } from "./core.mjs";
import { readXlsx } from "./xlsx.mjs";
import {
  IMPORT_FIELDS,
  suggestMapping,
  prepareImport,
  issuesCSV,
} from "./lib/importer.mjs";
const $ = (s) => document.querySelector(s);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function mountImporter({ onCommit, download }) {
  let file = null,
    raw = [],
    checked = null,
    report = null;
  const dialog = $("#import-dialog");
  function config() {
    return {
      mode: $("#import-mode").value,
      mapping: Object.fromEntries(
        [...document.querySelectorAll("[data-map]")].map((s) => [
          s.dataset.map,
          s.value,
        ]),
      ),
      currency: $("#import-currency").value,
      revenueBasis: $("#import-basis").value,
      dateFormat: $("#import-date").value,
      duplicates: $("#import-duplicates").value,
      statusValues: $("#import-statuses").value,
      fillZeros: $("#import-zero").checked,
      complete: $("#import-complete").checked,
      strictFunnel: $("#import-funnel").checked,
      thousands: $("#import-thousands").checked,
      coverageStart: $("#import-start").value,
      coverageEnd: $("#import-end").value,
    };
  }
  function invalidate() {
    checked = null;
    $("#import-commit").disabled = true;
    $("#import-quality").textContent = "配置已更新，请先检查数据。";
  }
  function mappingFields() {
    const map = suggestMapping(Object.keys(raw[0] || {}));
    $("#import-mapping").innerHTML = Object.entries(IMPORT_FIELDS)
      .map(
        ([f, label]) =>
          `<label>${escape(label)}<select data-map="${f}" aria-label="映射 ${escape(label)}"><option value="">不提供</option>${Object.keys(
            raw[0] || {},
          )
            .map(
              (h) =>
                `<option value="${escape(h)}" ${map[f] === h ? "selected" : ""}>${escape(h)}</option>`,
            )
            .join("")}</select></label>`,
      )
      .join("");
    $("#import-rows").textContent =
      `${file.name} · ${raw.length.toLocaleString()}行 · ${Object.keys(raw[0] || {}).length}列。仅映射字段进入分析；导入后请核查金额口径。`;
    document
      .querySelectorAll("[data-map]")
      .forEach((s) => (s.onchange = invalidate));
  }
  async function parse() {
    if (!file) return;
    try {
      raw = file.name.toLowerCase().endsWith(".xlsx")
        ? await readXlsx(await file.arrayBuffer())
        : parseCSV(
            new TextDecoder($("#import-encoding").value, {
              fatal: true,
            }).decode(await file.arrayBuffer()),
            { delimiter: $("#import-delimiter").value },
          );
      mappingFields();
      invalidate();
    } catch (e) {
      raw = [];
      $("#import-mapping").innerHTML = "";
      $("#import-rows").textContent = "";
      $("#import-quality").textContent =
        "文件读取失败：" + e.message + "。CSV可尝试切换编码或分隔符。";
      $("#import-commit").disabled = true;
    }
  }
  $("#file").onchange = async (e) => {
    file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.(csv|xlsx|tsv)$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
      alert("请选择5 MB以内的CSV、TSV或XLSX文件");
      return;
    }
    checked = null;
    report = null;
    $("#import-issues").disabled = true;
    $("#import-mode").value = "daily";
    $("#import-encoding").value = "utf-8";
    $("#import-delimiter").value = file.name.endsWith(".tsv") ? "\t" : ",";
    $("#import-date").value = "YMD";
    $("#import-currency").value = "CNY";
    $("#import-basis").value = "gross";
    $("#import-duplicates").value = "reject";
    $("#import-statuses").value = "";
    $("#import-start").value = "";
    $("#import-end").value = "";
    for (const id of ["zero", "complete", "funnel", "thousands"])
      $("#import-" + id).checked = false;
    dialog.showModal();
    await parse();
  };
  $("#import-encoding").onchange = $("#import-delimiter").onchange = parse;
  document
    .querySelectorAll("#import-options input,#import-options select")
    .forEach((e) => (e.onchange = invalidate));
  $("#import-check").onclick = () => {
    checked = prepareImport(raw, config());
    report = checked.report;
    $("#import-commit").disabled = !checked.ok;
    $("#import-issues").disabled = !report.issues.length;
    $("#import-quality").textContent =
      (checked.ok
        ? "检查通过，等待确认导入。"
        : "检查未通过：" + checked.error) +
      "\n" +
      `源数据 ${report.sourceRows}行 · 纳入 ${report.acceptedRows}行 · 状态排除 ${report.excludedRows}行 · 聚合 ${report.aggregatedRows}行 · 补零 ${report.filledRows}行 · 浮点表示修正 ${report.precisionNormalized}项 · 输出 ${report.outputRows}行\n` +
      report.warnings.join("\n") +
      "\n" +
      report.issues
        .slice(0, 8)
        .map((x) => `第${x.row ?? "配置"}行：${x.message}`)
        .join("\n") +
      (report.errorCount > 8
        ? `\n共有${report.errorCount}项问题，导出最多前100项定位。`
        : "");
  };
  $("#import-issues").onclick = () => {
    if (report)
      download(
        "opspilot_import_issues.csv",
        issuesCSV(report),
        "text/csv;charset=utf-8",
      );
  };
  $("#import-commit").onclick = async () => {
    if (!checked?.ok) return;
    const payload = { ...checked, source: file.name };
    dialog.close();
    raw = [];
    file = null;
    checked = null;
    await onCommit(payload);
  };
  $("#import-cancel").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    raw = [];
    file = null;
    checked = null;
  });
}
