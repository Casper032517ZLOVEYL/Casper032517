import { analyze, METRICS } from '../core.mjs';
import { metricAvailability } from './importer.mjs';

/** Reuse the validated engine: no separate dashboard formulas or implicit zero fill. */
export function buildDashboard(rows, { metric = 'revenue', channel = '', start, end, dataset } = {}) {
  if (!METRICS[metric]) return { ok: false, error: '未知指标' };
  const available = metricAvailability(rows);
  if (!available[metric]?.available) return { ok: false, error: '源数据缺少该指标所需字段' };
  const options = { dataset, channel: channel || null, range: { start, end } };
  const trend = analyze(rows, `${METRICS[metric].name}趋势`, null, options);
  if (!trend.ok) return trend;
  const comparison = analyze(rows, `${METRICS[metric].name}变化`, null, options);
  return { ok: true, metric, trend, comparison, additive: !METRICS[metric].b,
    table: trend.details.map(d => {
      const prior = comparison.ok ? comparison.details.find(p => p.channel === d.channel) : null;
      return { channel: d.channel, current: d.current, previous: prior?.previous ?? null,
        relative: prior?.previous ? (d.current - prior.previous) / prior.previous : null,
        share: !METRICS[metric].b && trend.current > 0 ? d.current / trend.current : null };
    }) };
}

export function tablePage(rows, { search = '', sort = 'current', direction = 'desc', page = 1, pageSize = 10 } = {}) {
  if (!['channel','current','previous','relative','share'].includes(sort)) throw Error('无效排序字段');
  if (!['asc','desc'].includes(direction)) throw Error('无效排序方向');
  if (![10,20].includes(pageSize)) throw Error('无效页大小');
  const filtered = rows.filter(r => r.channel.toLowerCase().includes(search.trim().toLowerCase()));
  filtered.sort((a,b) => {
    const av = a[sort], bv = b[sort];
    if (av === null && bv === null) return a.channel.localeCompare(b.channel);
    if (av === null) return 1;
    if (bv === null) return -1;
    return (direction === 'asc' ? 1 : -1) * (typeof av === 'string' ? av.localeCompare(bv) : av-bv) || a.channel.localeCompare(b.channel);
  });
  const pages = Math.max(1, Math.ceil(filtered.length/pageSize));
  const currentPage = Math.max(1, Math.min(pages, Math.trunc(Number(page)) || 1));
  return { rows: filtered.slice((currentPage-1)*pageSize, currentPage*pageSize), filtered, page: currentPage, pages, total: filtered.length };
}

export function dashboardCSV(rows, metric, currency) {
  const q = v => '"' + (typeof v === 'string' && /^\s*[=+@-]/.test(v) ? "'" : '') + String(v ?? '').replaceAll('"','""') + '"';
  return '\uFEFF' + [['group','metric','currency','current','previous','relative_change','share'], ...rows.map(r=>[r.channel,metric,currency,r.current,r.previous,r.relative,r.share])].map(r=>r.map(q).join(',')).join('\r\n');
}
