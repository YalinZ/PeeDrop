const DAY = 86400000;
const OFFSET = 8 * 3600000;

function dayKey(time = Date.now()) {
  return new Date(time + OFFSET).toISOString().slice(0, 10);
}

function distance(a, b) {
  const rad = Math.PI / 180;
  const x = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) *
    Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, x)));
}

// 跨午夜的有效线段按两侧采样时间占比分日，单位始终为米。
function addSegment(totals, from, to, meters) {
  let cursor = from;
  while (cursor < to) {
    const end = Math.min(to, Math.floor((cursor + OFFSET) / DAY) * DAY + DAY - OFFSET);
    const key = dayKey(cursor);
    totals[key] = (totals[key] || 0) + meters * (end - cursor) / (to - from);
    cursor = end;
  }
}

module.exports = { dayKey, distance, addSegment, DAY, OFFSET };
