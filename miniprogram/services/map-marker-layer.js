const TYPES = {
  poop: ['💩', '拉粑粑'], pee: ['💦', '尿尿'], edog: ['🐕', 'e狗求玩'],
  idog: ['🫣', 'i狗勿扰'], danger: ['🛑', '烈性犬'], poison: ['☠️', '有毒物'],
  police: ['🚓', '查狗队'], cat: ['😼', '猫猫怪物出没'],
  grass: ['📍', '宝藏草坪'], cafe: ['☕', '宠物友好']
};
const valid = (lng, lat) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
function timestamp(value) {
  if (value && typeof value.getTime === 'function') value = value.getTime();
  else if (value && value.$date !== undefined) value = value.$date;
  if (typeof value === 'string') value = Date.parse(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : -Infinity;
}
function callout(content, cluster = false) {
  return { content, display: 'ALWAYS', color: '#1A1A1A', fontSize: 18,
    borderWidth: 2, borderColor: '#1A1A1A', borderRadius: 24,
    bgColor: cluster ? '#FFC000' : '#FFFFFF', padding: 8, textAlign: 'center' };
}
class MapMarkerLayer {
  constructor(page) {
    this.page = page;
    this.ids = new Map();
    this.nextId = 1;
    this.nextClusterId = 1000000000;
    this.clusters = new Map();
    this.records = [];
    this.version = 0;
    this.onClusters = this.onClusters.bind(this);
  }
  setRecords(rows) {
    if (this.disposed) return;
    this.version++;
    this.clusters.clear();
    const latest = new Map();
    for (const row of rows) {
      if (!row) continue;
      const longitude = row.location?.longitude ?? row.location?.coordinates?.[0] ?? row.longitude;
      const latitude = row.location?.latitude ?? row.location?.coordinates?.[1] ?? row.latitude;
      if (!valid(longitude, latitude)) continue;
      // 精确坐标去重，不合并仅仅相近的位置。
      const key = `${longitude}:${latitude}`;
      const previous = latest.get(key);
      const time = timestamp(row.createTime);
      if (!previous || time > previous.time || (time === previous.time &&
          String(row._id || '') > String(previous.row._id || ''))) {
        latest.set(key, { row, longitude, latitude, time });
      }
    }
    const activeKeys = new Set();
    this.records = Array.from(latest.values()).map(({ row, longitude, latitude }) => {
      const key = `${longitude}:${latitude}`;
      activeKeys.add(key);
      if (!this.ids.has(key)) this.ids.set(key, this.nextId++);
      const [emoji, label] = TYPES[row.type] || ['📍', '附近打卡'];
      return { id: this.ids.get(key), longitude, latitude, openid: row._openid,
        message: row.message || '', emoji, label,
        iconPath: '/images/tab_map.png', width: 1, height: 1, callout: callout(emoji) };
    });
    for (const key of this.ids.keys()) if (!activeKeys.has(key)) this.ids.delete(key);
    this.render();
  }
  attach(context) {
    if (this.context || this.disposed) return;
    this.context = context;
    if (!context || typeof context.initMarkerCluster !== 'function' ||
        typeof context.on !== 'function' || typeof context.addMarkers !== 'function') return;
    context.on('markerClusterCreate', this.onClusters);
    // 初始化回调尚未返回时也能接收原生聚合事件。
    this.ready = true;
    context.initMarkerCluster({
      enableDefaultStyle: false, zoomOnClick: true, gridSize: 80,
      success: () => { if (!this.disposed) this.render(); },
      fail: error => this.disableCluster(error)
    });
    this.render();
  }
  disableCluster(error) {
    if (this.disposed) return;
    console.error('点聚合不可用，保留普通Emoji气泡', error);
    this.ready = false;
    this.clusters.clear();
    this.render();
  }
  render() {
    if (this.disposed) return;
    const version = this.version;
    const markers = this.records.map(item => ({ ...item, joinCluster: !!this.ready }));
    // 始终保留WXML markers和原生callout，不以空数组等待自定义插槽。
    this.page.setData({ markers }, () => {
      if (this.disposed || version !== this.version || !this.context?.addMarkers) return;
      this.context.addMarkers({ markers, clear: true, fail: error => {
        if (!this.disposed && version === this.version && this.ready) this.disableCluster(error);
      } });
    });
  }
  onClusters(event) {
    if (this.disposed || !this.ready) return;
    const byId = new Map(this.records.map(item => [item.id, item]));
    const markers = [];
    for (const cluster of event.clusters || []) {
      const members = (cluster.markerIds || []).map(id => byId.get(id)).filter(Boolean);
      const longitude = cluster.center?.longitude ?? cluster.center?.lng;
      const latitude = cluster.center?.latitude ?? cluster.center?.lat;
      if (members.length < 2 || !valid(longitude, latitude)) continue;
      const old = this.clusters.get(cluster.clusterId);
      const id = old ? old.id : this.nextClusterId++;
      const emojis = Array.from(new Set(members.map(item => item.emoji)));
      const content = `${emojis.slice(0, 3).join(' ')}${emojis.length > 3 ? ' …' : ''} ×${members.length}`;
      this.clusters.set(cluster.clusterId, { id, members });
      markers.push({ id, clusterId: cluster.clusterId, longitude, latitude,
        iconPath: '/images/tab_map.png', width: 1, height: 1,
        joinCluster: false, callout: callout(content, true) });
    }
    if (!markers.length) return;
    if (this.clusters.size > Math.max(128, this.records.length * 4)) {
      this.version++;
      this.clusters.clear();
      this.render();
      return;
    }
    this.context.addMarkers({ markers, clear: false, fail: error => this.disableCluster(error) });
  }
  tap(markerId) {
    const cluster = Array.from(this.clusters.values()).find(item => item.id === markerId);
    if (!cluster) return false;
    this.context.includePoints({
      points: cluster.members.map(({ longitude, latitude }) => ({ longitude, latitude })),
      padding: [80, 60, 180, 60], fail: error => console.error('展开聚合标记失败', error)
    });
    return true;
  }
  dispose() {
    this.disposed = true;
    this.version++;
    if (typeof this.context?.off === 'function') this.context.off('markerClusterCreate', this.onClusters);
    this.clusters.clear();
    this.ids.clear();
    this.records = [];
  }
}
module.exports = MapMarkerLayer;
