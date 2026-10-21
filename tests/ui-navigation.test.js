const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function component({ page, app, switchTab }) {
  let definition;
  const notices = [];
  const sandbox = {
    Component: value => { definition = value; },
    require: () => ({ loadUIImages() {}, onUIAssetError() {} }),
    getCurrentPages: () => [page], getApp: () => app,
    wx: { switchTab, showToast: value => notices.push(value) },
    console: { error() {} }
  };
  vm.runInNewContext(fs.readFileSync('miniprogram/custom-tab-bar/index.js', 'utf8'), sandbox);
  const instance = {
    ...definition.methods, data: { ...definition.data },
    setData(update) { Object.assign(this.data, update); }
  };
  definition.lifetimes.attached.call(instance);
  return { instance, notices, detach: () => definition.lifetimes.detached.call(instance) };
}

test('中间按钮在地图页等待面板请求，快速连点不会重复触发', async () => {
  const wait = deferred();
  let opens = 0;
  let navigations = 0;
  const app = { globalData: {} };
  const { instance } = component({
    app, page: { route: 'pages/map/map', openPendingMarkerPanel: () => { opens++; return wait.promise; } },
    switchTab: () => { navigations++; }
  });
  const first = instance.onAddMarker();
  await instance.onAddMarker();
  assert.equal(opens, 1);
  assert.equal(navigations, 0);
  wait.resolve();
  await first;
  assert.equal(instance._navigating, false);
});

test('用户页中间按钮保留打卡意图并切到地图；失败后可再次操作', async () => {
  const app = { globalData: {} };
  let attempts = 0;
  const { instance, notices } = component({
    app, page: { route: 'pages/user/user' },
    switchTab: options => {
      attempts++;
      assert.equal(options.url, '/pages/map/map');
      assert.equal(app.globalData.pendingAddMarker, true);
      if (attempts === 1) options.fail(new Error('navigation failed'));
      else options.success();
    }
  });
  assert.equal(instance.data.selected, 1);
  await instance.onAddMarker();
  assert.equal(app.globalData.pendingAddMarker, false);
  assert.equal(instance._navigating, false);
  assert.equal(notices.length, 1);
  await instance.onAddMarker();
  assert.equal(attempts, 2);
  assert.equal(app.globalData.pendingAddMarker, true);
});

test('无效路由不导航，组件销毁后不再更新选中态', async () => {
  let navigations = 0;
  const { instance, detach } = component({
    app: { globalData: {} }, page: { route: 'pages/map/map' },
    switchTab: options => { navigations++; options.success(); }
  });
  await instance.switchTab({ currentTarget: { dataset: { path: '/pages/missing/index' } } });
  assert.equal(navigations, 0);
  detach();
  instance.setData = () => { throw Error('updated detached component'); };
  instance.syncSelected();
});

function mapPage() {
  let definition;
  const databaseRequest = deferred();
  let queries = 0;
  const app = {
    globalData: { pendingAddMarker: true },
    cloudInitPromise: Promise.resolve(),
    getIdentity: async () => ({ openid: 'owner' }),
    cloud: { database: () => ({ collection: () => ({ where: () => ({ limit: () => ({
      get: () => { queries++; return databaseRequest.promise; }
    }) }) }) }) }
  };
  const sandbox = {
    Page: value => { definition = value; }, getApp: () => app,
    require: createRequire(require.resolve('../miniprogram/pages/map/map.js')),
    wx: {}, clearTimeout, console: { error() {} }
  };
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/map/map.js', 'utf8'), sandbox);
  const page = {
    ...definition, data: structuredClone(definition.data), _mapVisible: true,
    setData(update) { Object.assign(this.data, update); }
  };
  return { page, app, databaseRequest, queries: () => queries };
}

test('地图等档案就绪后只打开一次打卡面板', async () => {
  const { page, app, databaseRequest, queries } = mapPage();
  const first = page.openPendingMarkerPanel();
  const second = page.openPendingMarkerPanel();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queries(), 1);
  assert.equal(page.data.showActionPanel, false);
  databaseRequest.resolve({ data: [{ _id: 'profile' }] });
  await Promise.all([first, second]);
  assert.equal(page.data.hasProfile, true);
  assert.equal(page.data.showActionPanel, true);
  assert.equal(app.globalData.pendingAddMarker, false);
});

test('等待档案时离开地图，迟到响应不会打开面板', async () => {
  const { page, app, databaseRequest } = mapPage();
  const pending = page.openPendingMarkerPanel();
  await new Promise(resolve => setImmediate(resolve));
  page.onHide();
  databaseRequest.resolve({ data: [{ _id: 'profile' }] });
  await pending;
  assert.equal(page.data.showActionPanel, false);
  assert.equal(app.globalData.pendingAddMarker, false);
  assert.equal(page._openingMarker, null);
});
