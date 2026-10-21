const test = require('node:test');
const assert = require('node:assert/strict');
const MapMarkerLayer = require('../miniprogram/services/map-marker-layer');
function harness() {
  const calls = [], events = {}, removals = [];
  const page = { data: {}, setData(value, done) { Object.assign(this.data, value); if (done) done(); } };
  const context = {
    on(name, callback) { events[name] = callback; },
    off(name, callback) { removals.push(name); assert.equal(events[name], callback); },
    initMarkerCluster(options) { this.options = options; options.success(); },
    addMarkers(options) { calls.push(options); },
    includePoints(options) { this.included = options.points; }
  };
  const layer = new MapMarkerLayer(page);
  return { layer, page, context, calls, events, removals };
}
const row = (id, longitude = 121, latitude = 31) => ({
  _id: id, _openid: 'owner-' + id, longitude, latitude, type: 'pee'
});
test('Emoji在地图未就绪、初始化无回调或失败时仍通过markers绑定显示', () => {
  const h = harness();
  h.layer.setRecords([row('a'), row('b', 122)]);
  const a = h.page.data.markers[0].id;
  assert.equal(h.page.data.markers[0].callout.content, '💦');
  assert.equal(h.page.data.markers[0].customCallout, undefined);
  h.context.initMarkerCluster = options => { h.context.options = options; };
  h.layer.attach(h.context);
  assert.ok(h.calls.length > 0);
  assert.equal(h.page.data.markers.length, 2);
  assert.equal(h.calls.at(-1).markers[0].joinCluster, true);
  h.context.options.fail(new Error('not supported'));
  assert.equal(h.page.data.markers[0].joinCluster, false);
  assert.equal(h.page.data.markers[0].id, a);
  assert.equal(h.page.data.markers[0].callout.borderColor, '#1A1A1A');
});
test('同坐标只保留最新记录且与输入顺序无关；相近坐标不合并', () => {
  const h = harness();
  const old = { ...row('old'), createTime: new Date('2026-10-20'), type: 'poop' };
  const latest = { ...row('new'), createTime: new Date('2026-10-21'), type: 'cat', message: '最新' };
  const near = row('near', 121.0000001);
  for (const rows of [[latest, old, near], [old, near, latest]]) {
    h.layer.setRecords(rows);
    assert.equal(h.page.data.markers.length, 2);
    const at = h.page.data.markers.find(item => item.longitude === 121);
    assert.equal(at.callout.content, '😼');
    assert.equal(at.label, '猫猫怪物出没');
    assert.equal(at.message, '最新');
    assert.equal(at.openid, 'owner-new');
  }
});
test('十种Emoji与现有打卡面板文案一一对应', () => {
  const h = harness();
  const expected = [
    ['poop','💩','拉粑粑'], ['pee','💦','尿尿'], ['edog','🐕','e狗求玩'],
    ['idog','🫣','i狗勿扰'], ['danger','🛑','烈性犬'], ['poison','☠️','有毒物'],
    ['police','🚓','查狗队'], ['cat','😼','猫猫怪物出没'],
    ['grass','📍','宝藏草坪'], ['cafe','☕','宠物友好']
  ];
  h.layer.setRecords(expected.map(([type], i) => ({ ...row(String(i), 121 + i / 100), type })));
  h.page.data.markers.forEach((marker, i) => {
    assert.equal(marker.callout.content, expected[i][1]);
    assert.equal(marker.label, expected[i][2]);
  });
});
test('聚合气泡显示真实Emoji组合及去重后的点数，增量簇保留clusterId', () => {
  const h = harness();
  h.layer.setRecords([row('a'), {...row('b',121.01),type:'poop'},row('c',121.02),row('d',121.03)]);
  h.layer.attach(h.context);
  const ids = h.page.data.markers.map(item => item.id);
  const cluster = (clusterId, markerIds) => ({clusterId,markerIds,center:{lat:31,lng:121}});
  h.events.markerClusterCreate({clusters:[cluster(10,ids.slice(0,2))]});
  let marker = h.calls.at(-1).markers[0];
  assert.equal(marker.callout.content,'💦 💩 ×2');
  assert.equal(marker.callout.bgColor,'#FFC000');
  assert.equal(marker.joinCluster,false);
  assert.equal(marker.clusterId,10);
  h.events.markerClusterCreate({clusters:[cluster(11,ids.slice(2))]});
  assert.equal(h.layer.clusters.size,2);
  marker = h.calls.at(-1).markers[0];
  h.layer.tap(marker.id);
  assert.equal(h.context.included.length,2);
  h.layer.setRecords([row('a')]);
  h.events.markerClusterCreate({clusters:[cluster(10,ids.slice(0,2))]});
  assert.equal(h.layer.clusters.size,0);
});
test('销毁后忽略原生回调，回收监听和缓存', () => {
  const h = harness();
  h.layer.attach(h.context);
  h.layer.dispose();
  h.page.setData=()=>{throw Error('updated disposed page');};
  h.events.markerClusterCreate({clusters:[]});
  assert.deepEqual(h.removals,['markerClusterCreate']);
});
