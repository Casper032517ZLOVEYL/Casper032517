import { METRICS, format } from "../core.mjs";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function chart(r) {
  const rank = r.plan.intent === "ranking",
    data = rank
      ? r.ranking.map((x) => ({ date: x.channel, value: x.current }))
      : r.trend,
    m = r.plan.metric,
    W = 560,
    H = 225,
    left = 110,
    right = 16,
    top = 12,
    bottom = 39,
    max = Math.max(...data.map((x) => x.value ?? 0), 0.00001) * 1.13,
    pw = W - left - right,
    ph = H - top - bottom;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(METRICS[m].name)}${rank ? "渠道排名" : "每日趋势"}">`;
  for (let i = 0; i < 4; i++) {
    let y = top + (ph * i) / 3,
      v = max * (1 - i / 3);
    svg += `<line x1="${left}" y1="${y}" x2="${W - right}" y2="${y}" stroke="#e9edf4"/><text x="${left - 9}" y="${y + 4}" text-anchor="end" fill="#8492a8" font-size="11">${esc(format(v, m, r.currency))}</text>`;
  }
  const x = (i) => left + ((i + 0.5) * pw) / data.length,
    y = (v) => top + ph - (v / max) * ph;
  if (rank) {
    data.forEach((d, i) => {
      if (d.value !== null)
        svg += `<rect x="${x(i) - (pw / data.length) * 0.24}" y="${y(d.value)}" width="${(pw / data.length) * 0.48}" height="${top + ph - y(d.value)}" rx="4" fill="#4d76ed"><title>${esc(d.date)}：${esc(format(d.value, m, r.currency))}</title></rect>`;
    });
  } else {
    let segments = [],
      segment = [];
    data.forEach((d, i) => {
      if (d.value === null) {
        if (segment.length) segments.push(segment);
        segment = [];
      } else segment.push(`${x(i)},${y(d.value)}`);
    });
    if (segment.length) segments.push(segment);
    for (let s of segments)
      svg += `<polyline points="${s.join(" ")}" fill="none" stroke="#4773ed" stroke-width="2.7"/>`;
    data.forEach((d, i) => {
      if (d.value !== null)
        svg += `<circle cx="${x(i)}" cy="${y(d.value)}" r="3.5" fill="white" stroke="#4773ed" stroke-width="2"><title>${esc(d.date)}：${esc(format(d.value, m, r.currency))}</title></circle>`;
    });
  }
  data.forEach((d, i) => {
    if (
      rank ||
      i === 0 ||
      i === data.length - 1 ||
      i % Math.ceil(data.length / 5) === 0
    )
      svg += `<text x="${x(i)}" y="${H - 13}" text-anchor="middle" fill="#8492a8" font-size="11">${esc(rank ? d.date : d.date.slice(5))}</text>`;
  });
  return svg + "</svg>";
}
