const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { UI_ASSETS, UI_BASE_URL } = require('../miniprogram/utils/ui-assets');

test('11张UI素材使用大写UI目录，剩余本地图片引用全部存在', () => {
  assert.equal(Object.keys(UI_ASSETS).length, 11);
  assert.equal(UI_ASSETS.paw, UI_BASE_URL + '01-paw-button.png');
  assert.ok(Object.values(UI_ASSETS).every(file => file.includes('/UI/')));
  const root = path.resolve('miniprogram');
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  for (const file of walk(root).filter(file => /\.(js|wxml|wxss|json)$/.test(file))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [ref] of source.matchAll(/\/images\/[\w.-]+/g)) {
      assert.ok(fs.existsSync(path.join(root, ref.slice(1))), file + '引用不存在的图片：' + ref);
      assert.match(ref, /\/tab_(map|user)(_active)?\.png$/);
    }
  }
});

test('UI图片通过跨账号实例批量获取，单张失败不影响其他图片，失败可重试', async t => {
  t.mock.method(console, 'warn', () => {});
  delete require.cache[require.resolve('../miniprogram/services/avatar-images')];
  delete require.cache[require.resolve('../miniprogram/services/ui-images')];
  let denied = true;
  const requests = [];
  global.getApp = () => ({ cloudInitPromise: Promise.resolve(), cloud: {
    getTempFileURL: async ({ fileList }) => {
      requests.push(fileList);
      return { fileList: fileList.map(fileID => denied && fileID === UI_ASSETS.bone
        ? { fileID, status: -1, errMsg: 'denied' }
        : { fileID, status: 0, tempFileURL: 'https://example.com/' + fileID.split('/').pop() }) };
    }
  } });
  const { loadUIImages } = require('../miniprogram/services/ui-images');
  const { resolveUIImage, resolveAvatarImage } = require('../miniprogram/services/avatar-images');
  const target = { data: { uiImages: {} }, setData(update) { Object.assign(this.data, update); } };
  await loadUIImages(target, ['paw', 'bone', 'trophy']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].length, 3);
  assert.ok(target.data.uiImages.paw.endsWith('01-paw-button.png'));
  assert.equal(target.data.uiImages.bone, undefined);
  assert.ok(target.data.uiImages.trophy);
  denied = false;
  await loadUIImages(target, ['paw', 'bone', 'trophy']);
  assert.deepEqual(requests[1], [UI_ASSETS.bone]);
  assert.ok(target.data.uiImages.bone);
  await assert.rejects(resolveUIImage(UI_ASSETS.paw.replace('/UI/', '/ui/')), /无效UI/);
  await assert.rejects(resolveAvatarImage(UI_ASSETS.paw), /无效头像/);
});

test('等待其他素材期间的新结果不被旧请求覆盖；销毁后不更新且图片错误只自动重试一次', async () => {
  const tasks = [];
  const exported = { exports: {} };
  vm.runInNewContext(fs.readFileSync('miniprogram/services/ui-images.js', 'utf8'), {
    module: exported, console: { warn() {} },
    require: name => name.includes('ui-assets') ? { UI_ASSETS } : {
      resolveUIImage: (file, force) => new Promise(resolve => tasks.push({ file, force, resolve }))
    }
  });
  const { loadUIImages, onUIAssetError } = exported.exports;
  const target = { data: { uiImages: {} }, setData(update) { Object.assign(this.data, update); } };
  const first = loadUIImages(target, ['paw', 'bone']);
  tasks[0].resolve('https://example.com/old.png');
  await new Promise(resolve => setImmediate(resolve));
  const latest = loadUIImages(target, ['paw'], true);
  tasks[2].resolve('https://example.com/new.png');
  await latest;
  tasks[1].resolve('https://example.com/bone.png');
  await first;
  assert.equal(target.data.uiImages.paw, 'https://example.com/new.png');
  const retry = onUIAssetError(target, { currentTarget: { dataset: { asset: 'paw' } } });
  assert.equal(tasks[3].force, true);
  onUIAssetError(target, { currentTarget: { dataset: { asset: 'paw' } } });
  assert.equal(tasks.length, 4);
  target._unloaded = true;
  target.setData = () => { throw Error('updated unloaded page'); };
  tasks[3].resolve('https://example.com/late.png');
  await retry;
});
