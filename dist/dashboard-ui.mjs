import { METRICS, format } from './core.mjs';
import { metricAvailability } from './lib/importer.mjs';
import { buildDashboard, tablePage, dashboardCSV } from './lib/dashboard.mjs';
import { chart } from './lib/charts.mjs';
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors = ['#315dea','#0b9489','#e8a33e','#9269cb','#df7889','#7294b4'];
export function mountDashboard({ getData, download }) {
  const $ = s => document.querySelector(s);
  let model = null, page = 1, filtered = [];
  const fmt = v => format(v, model.metric, model.trend.currency);
  const pct = v => v == null ? '—' : (v*100).toFixed(2)+'%';
  function table() {
    if (!model?.ok) return;
    const data = tablePage(model.table, {search:$('#dash-search').value,sort:$('#dash-sort').value,direction:$('#dash-direction').value,page});
    page = data.page; filtered = data.filtered;
    $('#dash-table').innerHTML = data.rows.length ? data.rows.map(r=>`<tr><th scope="row">${esc(r.channel)}</th><td>${esc(fmt(r.current))}</td><td>${r.previous===null?'—':esc(fmt(r.previous))}</td><td>${pct(r.relative)}</td><td>${pct(r.share)}</td></tr>`).join('') : '<tr><td colspan="5">没有匹配的分组，请调整搜索。</td></tr>';
    $('#dash-page').textContent = `共 ${data.total} 个分组 · 第 ${page} / ${data.pages} 页`;
    $('#dash-prev').disabled = page===1; $('#dash-next').disabled=page===data.pages;
    $('#dash-csv').disabled = !data.total;
  }
  function render() {
    const {rows,dataset} = getData();
    model = buildDashboard(rows,{metric:$('#dash-metric').value,channel:$('#dash-channel').value,start:$('#dash-start').value,end:$('#dash-end').value,dataset});
    $('#dash-error').hidden = model.ok; $('#dash-content').hidden = !model.ok;
    $('#dash-csv').disabled = !model.ok;
    if(!model.ok){$('#dash-error').textContent=model.error; return;}
    const t=model.trend,c=model.comparison;
    $('#dash-scope').textContent=`${t.range.begin} — ${t.range.end} · ${t.plan.channel || '全部分组'} · ${t.rows} 条日×分组记录 · ${t.currency}`;
    $('#dash-basis').textContent = dataset ? (dataset.revenueBasis==='paid'?'金额口径：用户声明的已支付订单金额。':'金额口径：正向销售额，支付状态未知，不代表净收入。') : '当前为合成漏斗示例，不是真实业务结果。';
    $('#dash-kpis').innerHTML = [
      ['本期'+METRICS[model.metric].name,fmt(t.current),`${t.plan.days}个自然日 · 汇总口径`],
      ['前一等长窗口',c.ok?fmt(c.previous):'暂无可比数据',c.ok?`${c.range.prevBegin} — ${c.range.prevEnd}`:'本期仍可查看；详见下方提示'],
      ['相对变化',c.ok?pct(c.relative):'—',c.ok?(c.relative===null?'基期为零或无有效分母':'描述性比较，不代表因果关系'):'前期缺失，不估算变化'],
      ['参与分组',String(t.details.length),'比率按汇总分子 / 汇总分母计算']
    ].map(([label,value,note])=>`<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div><small class="muted">${esc(note)}</small></div>`).join('');
    $('#dash-compare-note').hidden=c.ok;
    $('#dash-compare-note').textContent=c.ok?'':`前期比较不可用：${c.error}`;
    $('#dash-trend').innerHTML=chart(t);
    $('#dash-trend-name').textContent=METRICS[model.metric].name+' · 每日趋势';
    const ranking=[...t.details].filter(r=>r.current!==null).sort((a,b)=>b.current-a.current),max=Math.max(...ranking.map(r=>r.current),0.00001);
    $('#dash-bars').innerHTML=ranking.length?ranking.map((r,i)=>`<div class="dash-bar"><span title="${esc(r.channel)}">${esc(r.channel)}</span><div><i style="width:${r.current/max*100}%;background:${colors[i%colors.length]}"></i></div><strong>${esc(fmt(r.current))}</strong></div>`).join(''):'<p class="muted">所有分组的分母均为零，没有可计算的排名。</p>';
    const parts=model.table.filter(r=>r.share>0).sort((a,b)=>b.share-a.share);
    let offset=0;
    $('#dash-share').innerHTML = !model.additive ? '<p class="empty-chart">比率不相加，因此不展示占比。请查看分组排名及汇总口径。</p>' : !parts.length ? '<p class="empty-chart">本期总量为零，无法计算占比。</p>' : `<div class="donut-layout"><svg viewBox="0 0 160 160" role="img" aria-label="分组占比环形图"><circle cx="80" cy="80" r="55" fill="none" stroke="#edf1f8" stroke-width="22"/>${parts.map((r,i)=>{const circle=`<circle cx="80" cy="80" r="55" fill="none" stroke="${colors[i%colors.length]}" stroke-width="22" pathLength="100" stroke-dasharray="${r.share*100} ${100-r.share*100}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"><title>${esc(r.channel)} ${pct(r.share)}</title></circle>`; offset+=r.share*100; return circle;}).join('')}<text x="80" y="77" text-anchor="middle" fill="#19263b" font-size="23">${parts.length}</text><text x="80" y="98" text-anchor="middle" fill="#8492a8" font-size="12">有贡献分组</text></svg><ul>${parts.map((r,i)=>`<li><i style="background:${colors[i%colors.length]}"></i><span>${esc(r.channel)}</span><b>${pct(r.share)}</b></li>`).join('')}</ul></div>`;
    const peak=Math.max(...t.trend.map(d=>d.value??0),0.00001);
    const leading=(new Date(t.trend[0].date+'T00:00:00Z').getUTCDay()+6)%7;
    $('#dash-calendar').innerHTML='<div class="calendar-labels">'+['一','二','三','四','五','六','日'].map(d=>`<span>${d}</span>`).join('')+'</div><div class="calendar-grid">'+'<span></span>'.repeat(leading)+t.trend.map(d=>`<div class="calendar-cell" style="background:${d.value===null?'#edf0f5':`rgba(49,93,234,${0.06+0.74*(d.value/peak)})`};color:${d.value/peak>0.55?'#fff':'#19263b'}" tabindex="0" title="${esc(d.date)}：${esc(fmt(d.value))}"><small>${d.date.slice(5)}</small><b>${d.value===null?'—':esc(new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2,notation:'compact'}).format(d.value*(METRICS[model.metric].unit==='%'?100:1)))}</b></div>`).join('')+'</div>';
    $('#dash-calendar-unit').textContent=`${METRICS[model.metric].name} / ${METRICS[model.metric].unit==='货币'?t.currency:METRICS[model.metric].unit} · 深色表示数值较高；悬停或聚焦查看精确值。`;
    page=1; table();
  }
  function sync() {
    const {rows}=getData(),available=metricAvailability(rows),selected=$('#dash-metric').value;
    $('#dash-metric').innerHTML=Object.keys(METRICS).map(m=>`<option value="${m}" ${available[m]?.available?'':'disabled'}>${METRICS[m].name}${available[m]?.available?'':'（缺少字段）'}</option>`).join('');
    $('#dash-metric').value=available[selected]?.available?selected:Object.keys(METRICS).find(m=>available[m]?.available);
    $('#dash-channel').innerHTML='<option value="">全部分组</option>'+[...new Set(rows.map(r=>r.channel))].map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const end=rows.at(-1).date;
    $('#dash-end').value=end; $('#dash-start').value=new Date(Date.parse(end)-6*86400000).toISOString().slice(0,10);
    for(const id of ['dash-start','dash-end']){ $('#'+id).min=rows[0].date; $('#'+id).max=end; }
    $('#dash-search').value=''; render();
  }
  $('#dash-filters').onsubmit=e=>{e.preventDefault();render();};
  $('#dash-metric').onchange=$('#dash-channel').onchange=render;
  document.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{const end=$('#dash-end').value||getData().rows.at(-1).date; $('#dash-start').value=new Date(Date.parse(end)-(Number(b.dataset.days)-1)*86400000).toISOString().slice(0,10);render();});
  for(const id of ['dash-search','dash-sort','dash-direction']) $('#'+id).addEventListener(id==='dash-search'?'input':'change',()=>{page=1;table();});
  $('#dash-prev').onclick=()=>{page--;table();}; $('#dash-next').onclick=()=>{page++;table();};
  $('#dash-csv').onclick=()=>{if(model?.ok)download('opspilot_dashboard.csv',dashboardCSV(filtered,model.metric,model.trend.currency),'text/csv;charset=utf-8');};
  $('#dash-upload').onclick=()=>$('#file').click();
  return {sync};
}
