const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { dayKey, addSegment } = require('../miniprogram/utils/walk-math');
const WalkRecorder = require('../miniprogram/services/walk-recorder');
const META = 'liuweier.walk.v1';

function setup() {
  const storage = new Map();
  const listeners = new Set();
  const calls = [];
  const state = { offline: false, writeError: false };
  global.wx = {
    getStorageSync: key => structuredClone(storage.get(key)),
    setStorageSync: (key, value) => {
      if (state.writeError) throw Error('storage full');
      storage.set(key, structuredClone(value));
    },
    removeStorageSync: key => storage.delete(key),
    onLocationChange: fn => listeners.add(fn),
    offLocationChange: fn => listeners.delete(fn),
    startLocationUpdateBackground: options => options.success(),
    stopLocationUpdate: () => {}, showToast: () => {}
  };
  global.getApp = () => ({ cloudInitPromise: Promise.resolve(), cloud: {
    callFunction: async request => {
      calls.push(request);
      if (state.offline) throw Error('offline');
      return { result: { success: true } };
    }
  } });
  return { storage, listeners, calls, state };
}

test('北京时间日期、午夜前后分配距离', () => {
  const midnight = Date.parse('2026-10-20T00:00:00+08:00');
  assert.equal(dayKey(midnight - 1), '2026-10-19');
  assert.equal(dayKey(midnight), '2026-10-20');
  const totals = {};
  addSegment(totals, midnight - 10000, midnight + 30000, 40);
  assert.deepEqual(totals, { '2026-10-19': 10, '2026-10-20': 30 });
});

test('冷启动恢复路线和距离，中断前后的移动不计距离', async () => {
  const env = setup();
  const first = new WalkRecorder();
  await first.start();
  // 保持测试纯本地，不启动自动同步。
  first.lastSyncAt = Infinity;
  const realNow = Date.now;
  let time = realNow();
  Date.now = () => time;
  try {
    first.onLocation({ latitude: 31, longitude: 121, accuracy: 10 });
    time += 10000;
    first.onLocation({ latitude: 31.0001, longitude: 121, accuracy: 10 });
    const meters = first.session.totalDistance;
    assert.ok(meters > 10 && meters < 12);
    // 模拟进程回收：丢弃对象，从持久化存储创建全新服务。
    env.listeners.clear();
    const second = new WalkRecorder();
    second.lastSyncAt = Infinity;
    assert.equal(second.points.length, 2);
    assert.equal(second.session.totalDistance, meters);
    await second.resume();
    await second.resume();
    assert.equal(env.listeners.size, 1);
    time += 10000;
    second.onLocation({ latitude: 31.01, longitude: 121, accuracy: 10 });
    assert.equal(second.session.totalDistance, meters);
    time += 10000;
    second.onLocation({ latitude: 31.0101, longitude: 121, accuracy: 10 });
    assert.ok(second.session.totalDistance > meters);
    assert.equal(second.snapshot().polyline.length, 2);
    assert.equal(second.snapshot().trackInterrupted, true);
    // 单点分段不会渲染折线，非法坐标也不会持久化。
    const count = second.points.length;
    second.onLocation({ latitude: NaN, longitude: 121 });
    assert.equal(second.points.length, count);
  } finally { Date.now = realNow; }
});

test('结算断网保留 pending；冷启动重试成功才删除缓存', async () => {
  const env = setup();
  const recorder = new WalkRecorder();
  await recorder.start();
  recorder.lastSyncAt = Infinity;
  recorder.onLocation({ latitude: 0, longitude: 0, accuracy: 1 });
  env.state.offline = true;
  await assert.rejects(recorder.finish(), /offline/);
  assert.equal(env.storage.get(META).status, 'pending');
  const restored = new WalkRecorder();
  assert.equal(restored.points.length, 1);
  env.state.offline = false;
  await restored.finish();
  assert.equal(restored.session, null);
  assert.equal(env.storage.has(META), false);
  assert.equal(env.listeners.size, 0);
});

test('轨迹分片超过200点可完整恢复；写入失败不推进内存里程', async () => {
  const env = setup();
  const recorder = new WalkRecorder();
  await recorder.start();
  recorder.lastSyncAt = Infinity;
  const realNow = Date.now;
  let time = realNow();
  Date.now = () => time;
  try {
    for (let i = 0; i < 205; i++) {
      time += 10000;
      recorder.onLocation({ latitude: 31 + i * 0.0001, longitude: 121, accuracy: 5 });
    }
    assert.equal(new WalkRecorder().points.length, 205);
    const previousDistance = recorder.session.totalDistance;
    env.state.writeError = true;
    time += 10000;
    recorder.onLocation({ latitude: 31.0205, longitude: 121, accuracy: 5 });
    assert.equal(recorder.points.length, 205);
    assert.equal(recorder.session.totalDistance, previousDistance);
    assert.equal(env.listeners.size, 0);
  } finally { Date.now = realNow; }
});

// 隔离微信 SDK，验证实际云函数中的增量、幂等与过滤逻辑。
function backend() {
  let rows = new Map();
  const clone = value => value == null ? null : structuredClone(value);
  const collection = (name, target = () => rows) => ({
    doc: id => ({
      get: async () => ({ data: clone(target().get(`${name}/${id}`)) }),
      set: async ({ data }) => target().set(`${name}/${id}`, { ...clone(data), _id: id })
    }),
    where: condition => {
      const orders = [];
      let limit = Infinity;
      const query = {
        orderBy: (key, dir) => { orders.push([key, dir]); return query; },
        limit: count => { limit = count; return query; },
        get: async () => ({ data: name === 'pd_users' ? [{ _id: 'pet-profile', _openid: 'source-user', name: '测试狗', breed: '柯基' }] :
          [...rows.entries()].filter(([key, row]) => key.startsWith(name + '/') &&
            Object.entries(condition).every(([field, value]) => value && value.gt !== undefined ?
              row[field] > value.gt : row[field] === value)).map(([, row]) => clone(row))
            .sort((a, b) => {
              for (const [key, dir] of orders) {
                if (a[key] !== b[key]) return (a[key] > b[key] ? 1 : -1) * (dir === 'desc' ? -1 : 1);
              }
              return 0;
            }).slice(0, limit) })
      };
      return query;
    }
  });
  const db = {
    collection, command: { gt: value => ({ gt: value }), in: value => ({ in: value }) }, serverDate: () => new Date(),
    runTransaction: async fn => {
      const draft = new Map([...rows].map(([key, row]) => [key, clone(row)]));
      await fn({ collection: name => collection(name, () => draft) });
      rows = draft;
    }
  };
  const cloud = { init() {}, database: () => db, getWXContext: () => ({
    FROM_OPENID: 'source-user', FROM_APPID: 'source-app', OPENID: 'resource-user', APPID: 'resource-app'
  }) };
  const cloudRequire = createRequire(require.resolve('../cloudfunctions/walkStats/index.js'));
  const sandbox = { exports: {}, require: name => name === 'wx-server-sdk' ? cloud : cloudRequire(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../cloudfunctions/walkStats/index.js'), 'utf8'), sandbox);
  return { call: sandbox.exports.main, rows: () => rows };
}

test('云函数相同revision重试/旧请求不重复累计，结算后不接受更新', async () => {
  const { call, rows } = backend();
  const day = dayKey(Date.now());
  const session = { id: 'w1234567890abcd', startedAt: Date.now() - 1000,
    status: 'active', revision: 1, dailyDistances: { [day]: 100 } };
  await call({ action: 'sync', session });
  await call({ action: 'sync', session });
  const stat = () => [...rows()].find(([key]) => key.startsWith('pd_daily_stats/'))[1];
  assert.equal(stat().distance, 100);
  await call({ action: 'sync', session: { ...session, revision: 2, dailyDistances: { [day]: 150 } } });
  await call({ action: 'sync', session });
  assert.equal(stat().distance, 150);
  await call({ action: 'sync', session: { ...session, revision: 3, status: 'pending', dailyDistances: { [day]: 150 } } });
  await call({ action: 'sync', session: { ...session, revision: 4, dailyDistances: { [day]: 999 } } });
  assert.equal(stat().distance, 150);
  assert.equal((await call({ action: 'identity' })).openid, 'source-user');
});

test('云端今日榜排除昨天，并按距离降序返回', async () => {
  const { call } = backend();
  const day = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86400000);
  await call({ action: 'sync', session: { id: 'w1234567890abcd', startedAt: Date.now() - 86400000,
    status: 'pending', revision: 1, dailyDistances: { [yesterday]: 5000, [day]: 100 } } });
  const result = await call({ action: 'leaderboard', dayKey: yesterday });
  assert.equal(result.dayKey, day);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].todayDistance, 100);
});
