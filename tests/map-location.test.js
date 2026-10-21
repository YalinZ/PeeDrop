const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function page() {
  let definition;
  const queries = [], points = [], writes = [], notices = [], errors = [];
  let locate;
  class Point {
    constructor(longitude, latitude) {
      assert.equal(typeof longitude, 'number');
      assert.equal(typeof latitude, 'number');
      this.longitude = longitude;
      this.latitude = latitude;
      points.push(this);
    }
  }
  const database = {
    Geo: { Point }, command: { geoNear: value => value }, serverDate: () => new Date(),
    collection: () => ({
      where: value => {
        const query = {
          skip(offset) { this.offset = offset; return this; },
          limit(size) { this.size = size; return this; },
          get: () => new Promise((resolve, reject) => {
            queries.push({ value, offset: query.offset, size: query.size, resolve, reject });
          })
        };
        return query;
      },
      add: options => { writes.push(options.data); options.success({}); }
    })
  };
  const app = { cloudInitPromise: Promise.resolve(), cloud: { database: () => database } };
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/map/map.js', 'utf8'), {
    Page: value => { definition = value; }, getApp: () => app,
    require: createRequire(require.resolve('../miniprogram/pages/map/map.js')),
    wx: {
      getLocation: options => { locate = options; },
      showToast: value => notices.push(value), showLoading() {}, hideLoading() {}
    },
    console: { error: (...args) => errors.push(args) }, clearTimeout
  });
  const instance = { ...definition, data: { ...definition.data },
    setData(value) { Object.assign(this.data, value); } };
  return { instance, app, queries, points, writes, notices, errors, location: () => locate };
}

test('首次定位只查询一次，Geo.Point 使用构造调用并传入实际坐标', async () => {
  const h = page();
  h.instance.getUserLocation();
  h.location().success({ longitude: 121.5, latitude: 31.2 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.queries.length, 1);
  assert.equal(h.points[0].longitude, 121.5);
  assert.equal(h.points[0].latitude, 31.2);
  h.queries[0].resolve({ data: [] });
  await new Promise(resolve => setImmediate(resolve));
});

test('无参查询使用页面坐标，零度坐标有效；无效坐标不进入云SDK', async () => {
  const h = page();
  const first = h.instance.fetchNearbyMarkers();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.points[0].longitude, h.instance.data.longitude);
  h.queries[0].resolve({ data: [] });
  await first;
  const zero = h.instance.fetchNearbyMarkers(0, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.points[1].longitude, 0);
  assert.equal(h.points[1].latitude, 0);
  h.queries[1].resolve({ data: [] });
  await zero;
  for (const [lng, lat] of [[null, 30], [NaN, 30], [181, 30], [120, 91], ['120', 30]]) {
    await h.instance.fetchNearbyMarkers(lng, lat);
  }
  h.instance.data.longitude = undefined;
  await h.instance.fetchNearbyMarkers();
  assert.equal(h.queries.length, 2);
});

test('异常定位不覆盖地图坐标；数据库中的损坏标记被过滤', async () => {
  const h = page();
  h.instance.getUserLocation();
  h.location().success({ latitude: 30 });
  assert.equal(h.instance.data.longitude, 116.397428);
  assert.equal(h.queries.length, 0);
  assert.equal(h.notices.length, 1);
  const request = h.instance.fetchNearbyMarkers(0, 0);
  await new Promise(resolve => setImmediate(resolve));
  h.queries[0].resolve({ data: [
    { location: { longitude: 0, latitude: 0 }, type: 'pee' },
    { location: { coordinates: [121, 31] }, type: 'grass' },
    { location: { latitude: 30 } },
    { longitude: 200, latitude: 30 }
  ] });
  await request;
  assert.equal(h.instance.data.markers.length, 2);
  assert.equal(h.instance.data.markers[0].longitude, 0);
});

test('旧查询、销毁后的查询不覆盖视图，查询失败被捕获', async () => {
  const h = page();
  const old = h.instance.fetchNearbyMarkers(120, 30);
  await new Promise(resolve => setImmediate(resolve));
  const current = h.instance.fetchNearbyMarkers(121, 31);
  await new Promise(resolve => setImmediate(resolve));
  h.queries[1].resolve({ data: [{ longitude: 121, latitude: 31 }] });
  await current;
  h.queries[0].resolve({ data: [{ longitude: 120, latitude: 30 }] });
  await old;
  assert.equal(h.instance.data.markers[0].longitude, 121);
  const failed = h.instance.fetchNearbyMarkers();
  await new Promise(resolve => setImmediate(resolve));
  h.queries[2].reject(new Error('network'));
  await failed;
  assert.equal(h.errors.length, 1);
  const pending = h.instance.fetchNearbyMarkers();
  await new Promise(resolve => setImmediate(resolve));
  h.instance.onUnload();
  h.instance.setData = () => { throw new Error('updated unloaded page'); };
  h.queries[3].resolve({ data: [] });
  await pending;
  assert.equal(h.errors.length, 1);
});

test('新增标记同样使用合法的 Geo.Point，非法坐标不写数据库', async () => {
  const h = page();
  h.instance.data.longitude = 0;
  h.instance.data.latitude = 0;
  h.instance.onSelectMarker({ currentTarget: { dataset: { type: 'pee' } } });
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].location.longitude, 0);
  await new Promise(resolve => setImmediate(resolve));
  h.queries[0].resolve({ data: [] });
  await new Promise(resolve => setImmediate(resolve));
  h.instance.data.longitude = undefined;
  h.instance.onSelectMarker({ currentTarget: { dataset: { type: 'pee' } } });
  assert.equal(h.writes.length, 1);
});

test('同坐标超过默认返回数量时继续翻页，显示后续页中的最新打卡', async () => {
  const h = page();
  const pending = h.instance.fetchNearbyMarkers(121, 31);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.queries[0].size, 100);
  h.queries[0].resolve({ data: Array.from({ length: 100 }, (_, i) => ({
    _id: 'old-' + i, longitude: 121, latitude: 31, type: 'pee', createTime: i + 1
  })) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.queries[1].offset, 100);
  h.queries[1].resolve({ data: [{
    _id: 'newest', longitude: 121, latitude: 31, type: 'poop', createTime: 1000,
    _openid: 'latest-owner', message: '最新标记'
  }] });
  await pending;
  assert.equal(h.instance.data.markers.length, 1);
  assert.equal(h.instance.data.markers[0].callout.content, '💩');
  assert.equal(h.instance.data.markers[0].message, '最新标记');
  assert.equal(h.instance.data.markers[0].openid, 'latest-owner');
});
