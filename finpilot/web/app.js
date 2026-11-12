const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const state = {mode: 'offline', configured: false, scope: null, report: null, busy: false, turns: 0};
const labels = {revenue: '营业收入', net_income: '净利润', operating_cash_flow: '经营现金流'};
const kinds = {fact: '资料事实', calculation: '计算结果', hypothesis: '待验证推断'};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n) => n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN', {maximumFractionDigits: 2});
const pretty = (v) => esc(JSON.stringify(v, null, 2));

async function api(path, body) {
  const response = await fetch('/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data;
}
function notice(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').classList.toggle('error', error);
}
function busy(value, message = '') {
  state.busy = value;
  $$('main button, main input').forEach(el => el.disabled = value);
  $('#question').disabled = value;
  if (message) notice(message);
  $('#run').textContent = value ? '执行中…' : '开始研究 ↗';
}
async function perform(fn, message) {
  if (state.busy) return;
  busy(true, message);
  try { await fn(); }
  catch (error) { notice(error.message, true); }
  finally { busy(false); }
}
function setScope(scope) {
  state.scope = scope;
  state.turns = 0;
  state.report = null;
  $('#output').hidden = true;
  $('#empty').hidden = false;
  $('#changes').replaceChildren();
  $('#scope-count').textContent = scope.files.length ? `${scope.rows} 条指标 · ${scope.chunks} 个片段` : '尚未载入';
  $('#source-list').innerHTML = scope.files.map(f => `<div class="source-item">▤ <span>${esc(f)}</span></div>`).join('');
  $('#run-hint').textContent = scope.files.length ? '资料已就绪 · 可开始研究' : '先载入资料，再开始研究';
  $('#result-badge').textContent = '等待任务';
}
function setMode(mode) {
  state.mode = mode;
  $$('.mode').forEach(el => el.classList.toggle('selected', el.dataset.mode === mode));
  $('#consent-label').hidden = mode !== 'agent';
  $('#model-state').textContent = mode === 'offline'
    ? '固定规则计算与关键词检索；不理解复杂意图，也不会自主规划。'
    : state.configured ? '服务端模型已配置。最多8次模型调用，可按工具结果调整后续任务。'
      : '服务端尚未配置模型。请参照README填写.env后重启；当前可先体验离线流程。';
}
function switchTab(name) {
  $$('.tab').forEach(el => {
    const active = el.dataset.tab === name;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', String(active));
  });
  $$('.tab-panel').forEach(el => el.hidden = el.id !== name);
}
function citations(ids) {
  return ids.map(id => `<a href="#${esc(id)}" class="citation" data-evidence="${esc(id)}">[${esc(id)}]</a>`).join(' ');
}
function render(report) {
  state.report = report;
  $('#empty').hidden = true;
  $('#output').hidden = false;
  $('#result-badge').textContent = report.status === 'completed' ? (report.mode === 'model_agent' ? '模型任务完成 · 待复核' : '离线流程完成') : '任务未完成';
  const metricBlocks = Object.entries(report.calculations).flatMap(([company, rows]) => {
    const groups = new Map();
    for (const r of rows) groups.set(r.period.slice(6), r);
    return [...groups.values()].map(r => `<div class="section-label">${esc(company)} · ${esc(r.period)}</div>
      <div class="unit-note">金额：${esc(r.currency)} · ${esc({one:'元',thousand:'千元',million:'百万元'}[r.unit] || r.unit)}；财年口径需核对</div>
      <div class="metrics">${Object.entries(labels).map(([key, label]) => `<div class="metric"><div class="label">${label}</div><div class="value">${fmt(r.values[key])}</div><div class="delta">${r.yoy_pct[key] === null ? '上年同期不足 / 基数非正' : '同比 ' + (r.yoy_pct[key] >= 0 ? '+' : '') + fmt(r.yoy_pct[key]) + '%'}</div></div>`).join('')}</div>`);
  }).join('');
  $('#report').innerHTML = `<div class="card"><p class="history-line">${report.mode === 'model_agent' ? '模型生成内容 · 引用存在不等于结论已证实' : '固定规则流程 · 所列数字由程序计算'}</p><p class="report-summary">${esc(report.summary)}</p>${metricBlocks}
    <div class="section-label">研究发现</div>${report.findings.length ? report.findings.map(f => `<div class="finding"><span class="kind ${esc(f.kind)}">${esc(kinds[f.kind])}</span><p>${esc(f.text)}</p><div>${citations(f.evidence_ids)}</div></div>`).join('') : '<p class="hint">尚无通过格式与引用检查的研究发现，请查看执行记录。</p>'}
    ${report.open_questions.length ? `<div class="section-label">待核实与信息缺口</div><ul class="questions">${report.open_questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
    <div class="limitations">${report.limitations.map(esc).join('<br>')}</div></div>`;
  $('#evidence').innerHTML = report.evidence.map(e => {
    let source = '';
    try { const u = new URL(e.source); if (u.protocol === 'https:') source = `<a target="_blank" rel="noopener noreferrer" href="${esc(u.href)}">打开原始来源 ↗</a>`; } catch {}
    return `<article class="card evidence-item" id="${esc(e.id)}"><strong>${esc(e.id)}</strong><div>${esc(e.file)}${e.page ? ' · 第' + esc(e.page) + '页' : ''}</div>${source}<pre>${e.text ? esc(e.text) : pretty(e)}</pre></article>`;
  }).join('') || '<div class="card hint">暂无已返回的证据。</div>';
  $('#trace').innerHTML = `<div class="card"><div class="section-label">执行信息</div><p class="hint">${report.mode === 'model_agent' ? `模型调用：${esc(report.model_calls ?? '未知')} · 耗时：${esc(report.elapsed_seconds)}秒 · 费用：未知（未配置价格）` : '离线规则流程 · 无模型费用'}<br>以下仅展示动作与工具结果，不记录模型思维链。</p>${report.usage ? `<pre class="hint">${pretty(report.usage)}</pre>` : ''}</div>` + report.trace.map((t, i) => `<details class="card trace-item ${t.status === 'error' ? 'error' : ''}"><summary>${String(i+1).padStart(2,'0')} · ${esc(t.tool)} · ${t.status === 'ok' ? '已执行' : '失败'}</summary><pre>${pretty(t)}</pre></details>`).join('');
  switchTab('report');
  state.turns++;
  $('#run-hint').textContent = `已完成${state.turns}轮 · 最近4轮摘要用于模型追问`;
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function markdown(r) {
  const lines = ['# FinPilot研究报告', '', `问题：${r.question}`, `模式：${r.mode}；状态：${r.status}`, '', r.summary, '', '## 研究发现'];
  for (const f of r.findings) lines.push('', `- 【${kinds[f.kind]}】${f.text} [${f.evidence_ids.join(', ')}]`);
  lines.push('', '## 可复算指标', '', '```json', JSON.stringify(r.calculations, null, 2), '```', '', '## 信息缺口');
  r.open_questions.forEach(q => lines.push('- ' + q));
  lines.push('', '## 证据资料');
  for (const e of r.evidence) lines.push('', `### ${e.id}`, '', '```json', JSON.stringify(e, null, 2), '```');
  lines.push('', '## 能力边界', ...r.limitations.map(x => '- ' + x));
  return lines.join('\n');
}
async function filePayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({name: file.name, base64: String(reader.result).split(',')[1]});
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}
async function upload(files) {
  await perform(async () => {
    files = [...files];
    if (!files.length || files.length > 6) throw new Error('请选择1至6个文件');
    if (files.some(f => f.size > 5*1024*1024) || files.reduce((sum,f) => sum+f.size,0) > 10*1024*1024) throw new Error('单文件最多5MB，全部合计最多10MB');
    const payloads = await Promise.all(files.map(filePayload));
    setScope(await api('upload', {files: payloads}));
    notice('导入完成。请确认CSV与原文口径一致，再开始分析。');
  }, '正在读取并校验资料…');
  $('#files').value = '';
}
$('#sample').addEventListener('click', () => perform(async () => {setScope(await api('sample', {})); notice('已载入Apple FY2023/2024公开数据；此样例不是实时财报。');}, '正在载入公开样例…'));
$('#clear').addEventListener('click', () => perform(async () => {setScope(await api('reset', {})); notice('已清空服务端当前会话资料与追问摘要。');}, '正在清空…'));
$('#files').addEventListener('change', e => upload(e.target.files));
const zone = $('#dropzone');
zone.addEventListener('dragover', e => {e.preventDefault(); zone.classList.add('dragging');});
zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
zone.addEventListener('drop', e => {e.preventDefault();zone.classList.remove('dragging');if (!state.busy) upload(e.dataTransfer.files);});
$$('.mode').forEach(el => el.addEventListener('click', () => setMode(el.dataset.mode)));
$$('[data-question]').forEach(el => el.addEventListener('click', () => {$('#question').value = el.dataset.question;$('#question').focus();}));
$$('.tab').forEach(el => el.addEventListener('click', () => switchTab(el.dataset.tab)));
$('#output').addEventListener('click', e => {
  const link = e.target.closest('[data-evidence]');
  if (link) {e.preventDefault();switchTab('evidence');document.getElementById(link.dataset.evidence)?.scrollIntoView({block:'center'});}
});
$('#run').addEventListener('click', () => perform(async () => {
  if (!state.scope?.files.length) throw new Error('请先载入样例或上传资料');
  if (state.mode === 'agent' && !state.configured) throw new Error('请先在服务端配置.env并重启，或选择离线流程');
  if (state.mode === 'agent' && !$('#consent').checked) throw new Error('请先确认模型数据发送范围');
  const report = await api('analyze', {question: $('#question').value, mode: state.mode, consent: $('#consent').checked});
  render(report);
  notice(report.status === 'completed' ? '执行完成。点击引用查看证据，或导出完整执行记录。' : '任务未完成，已保留工具结果；请查看执行记录。', report.status !== 'completed');
}, '服务端正在执行任务，完成后显示实际步骤与结果。模型模式可能需要约1–2分钟。'));
$('#export-md').addEventListener('click', () => state.report && download('finpilot-report.md', markdown(state.report), 'text/markdown;charset=utf-8'));
$('#export-json').addEventListener('click', () => state.report && download('finpilot-run.json', JSON.stringify(state.report, null, 2), 'application/json'));
$('#snapshot').addEventListener('click', () => perform(async () => {
  if (!state.scope?.rows) throw new Error('请先载入结构化财务数据');
  download('finpilot-snapshot.json', JSON.stringify(await api('snapshot', {}), null, 2), 'application/json');notice('快照已生成；下次导入新数据后可上传此快照进行比较。');
}, '正在生成快照…'));
$('#old-snapshot').addEventListener('change', async e => {
  const file = e.target.files[0];if (!file) return;
  await perform(async () => {
    if (file.size > 1024*1024) throw new Error('历史快照不得超过1MB');
    const result = await api('compare', {snapshot: JSON.parse(await file.text())});
    const names = {new_period:'新增期间',changed_value:'数值变化',incomparable_basis:'币种或单位变化，无法比较',not_in_current_upload:'本次上传未包含此记录'};
    $('#changes').innerHTML = `<div class="changes">${result.changes.length ? result.changes.map(c => `<div class="change-row">${esc(c.company)} · ${esc(c.period)} · ${esc(names[c.type])}${c.metric ? `：${esc(labels[c.metric])} ${esc(c.before ?? '缺失')} → ${esc(c.after ?? '缺失')}` : ''}</div>`).join('') : '两次导入未发现指标变化。'}</div><p class="hint">${esc(result.note)}</p>`;
    notice('快照比较完成。');
  }, '正在比较历史快照…');
  e.target.value = '';
});
try {const data = await api('status');state.configured = data.model_configured;setScope(data.scope);setMode('offline');}
catch(error) {notice('无法连接本地服务：' + error.message, true);}
