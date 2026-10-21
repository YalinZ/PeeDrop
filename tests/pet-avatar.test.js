const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { AVATAR_BASE_URL: BASE, getPetAvatarUrl, toPetProfile, normalizePetType } = require('../miniprogram/utils/pet-avatar');
const { enrichLeaderboardPets } = require('../cloudfunctions/walkStats/pet-profiles');

test('8个精确品种全部使用新文件名，猫始终优先于狗的品种字典', () => {
  const breeds = { '柯基': 'corgi', '金毛': 'golden', '雪纳瑞': 'schnauzer', '比熊': 'bichon',
    '泰迪': 'teddy', '边牧': 'border_collie', '秋田': 'akita', '田园犬': 'tianyuan' };
  for (const [breed, filename] of Object.entries(breeds)) {
    assert.equal(getPetAvatarUrl('pet-1', 'dog', breed), BASE + filename + '.png');
    assert.match(getPetAvatarUrl('pet-1', 'cat', breed), /\/cat_[123]\.png$/);
  }
});

test('稳定ID、中文名字、长字符串均稳定，绝不调用 Math.random', () => {
  const original = Math.random;
  Math.random = () => { throw Error('random must not be called'); };
  try {
    for (const seed of ['pet-id-1', '小年糕', '🐶团子', 'x'.repeat(10000), 0]) {
      for (const type of ['dog', 'cat']) {
        assert.equal(getPetAvatarUrl(seed, type, ''), getPetAvatarUrl(seed, type, ''));
      }
    }
    assert.equal(getPetAvatarUrl('same-id', 'dog', '未知'), getPetAvatarUrl('same-id', 'dog', ''));
  } finally { Math.random = original; }
});

test('空值、异常类型、原型属性不会生成非法路径', () => {
  for (const value of [null, undefined, {}, [], NaN, Infinity, '', '__proto__', 'constructor']) {
    assert.match(getPetAvatarUrl(value, value, value), /\/random_dog_[123]\.png$/);
  }
  assert.equal(getPetAvatarUrl('id', ' DOG ', ' 柯基 '), BASE + 'corgi.png');
  assert.match(getPetAvatarUrl('id', '猫咪', null), /\/cat_[123]\.png$/);
});

test('档案、地图、跨日榜单使用同一petId；改名不会改变未知品种头像', () => {
  const profile = toPetProfile({ _id: 'stable-pet', name: '团子', breed: '拉布拉多', avatarUrl: 'old.png' });
  const renamed = toPetProfile({ ...profile, name: '新名字' });
  const board = toPetProfile({ _id: 'day-2026-10-20', petId: 'stable-pet', name: '团子', breed: '拉布拉多' }, { useDocumentId: false });
  assert.equal(profile.avatarUrl, renamed.avatarUrl);
  assert.equal(profile.avatarUrl, board.avatarUrl);
  assert.notEqual(profile.avatarUrl, 'old.png');
  const yesterday = toPetProfile({ _id: 'yesterday', name: '无ID团子' }, { useDocumentId: false });
  const today = toPetProfile({ _id: 'today', name: '无ID团子' }, { useDocumentId: false });
  assert.equal(yesterday.avatarUrl, today.avatarUrl);
});

test('兼容新旧类型和品种字段，但显式dog不会被旧breed猫覆盖', () => {
  assert.equal(normalizePetType(null, '猫'), 'cat');
  assert.equal(normalizePetType('dog', '猫'), 'dog');
  assert.equal(toPetProfile({ _id: 'a', breed: '猫' }).petType, 'cat');
  assert.equal(toPetProfile({ _id: 'a', type: 'CAT', breed: '暹罗' }).petType, 'cat');
  assert.equal(toPetProfile({ petId: 0, petType: 'cat' }).petId, '0');
  assert.equal(toPetProfile({ petId: 'a', petBreed: '田园犬', breed: '旧品种' }).avatarUrl, BASE + 'tianyuan.png');
});

function imageService(getTempFileURL) {
  delete require.cache[require.resolve('../miniprogram/services/avatar-images')];
  global.getApp = () => ({ cloudInitPromise: Promise.resolve(), cloud: { getTempFileURL } });
  return require('../miniprogram/services/avatar-images');
}

test('头像解析合并批次、复用相同文件请求，并缓存成功结果', async () => {
  const calls = [];
  const { resolveAvatarImage } = imageService(async request => {
    calls.push(request.fileList);
    return { fileList: request.fileList.map(fileID => ({ fileID, status: 0, tempFileURL: 'https://example.com/' + fileID.split('/').pop() })) };
  });
  const a = BASE + 'corgi.png', b = BASE + 'cat_1.png';
  const [one, two] = await Promise.all([resolveAvatarImage(a), resolveAvatarImage(a), resolveAvatarImage(b)]);
  assert.equal(one, two);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2);
  await resolveAvatarImage(a);
  assert.equal(calls.length, 1);
  await resolveAvatarImage(a, true);
  assert.equal(calls.length, 2);
});

test('单张头像失效不影响同批其他图片，失败不会永久缓存', async () => {
  let failed = true;
  const { resolveAvatarImage } = imageService(async ({ fileList }) => ({ fileList: fileList.map(fileID => (
    failed && fileID.endsWith('cat_1.png') ? { fileID, status: -1, errMsg: 'not found' }
      : { fileID, status: 0, tempFileURL: 'https://example.com/avatar.png' }
  )) }));
  const cat = resolveAvatarImage(BASE + 'cat_1.png');
  const dog = resolveAvatarImage(BASE + 'corgi.png');
  await Promise.all([assert.rejects(cat, /not found/), assert.doesNotReject(dog)]);
  failed = false;
  await assert.doesNotReject(resolveAvatarImage(BASE + 'cat_1.png', true));
  await assert.rejects(resolveAvatarImage('https://other.example.com/old.png'), /无效头像/);
});

test('临时链接到期后重新获取', async () => {
  let calls = 0;
  const { resolveAvatarImage } = imageService(async ({ fileList }) => ({ fileList: fileList.map(fileID => ({
    fileID, status: 0, maxAge: 1, tempFileURL: `https://example.com/${++calls}.png`
  })) }));
  const original = Date.now;
  let now = original();
  Date.now = () => now;
  try {
    const first = await resolveAvatarImage(BASE + 'corgi.png');
    now += 2000;
    const next = await resolveAvatarImage(BASE + 'corgi.png');
    assert.notEqual(first, next);
    assert.equal(calls, 2);
  } finally { Date.now = original; }
});

const ownerHash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);

test('历史榜单按owner关联真实档案，改过名字也不猜错；仅回填头像关联字段', async () => {
  const profiles = [
    { _id: 'real-pet', _openid: 'owner', name: '改过的名字', breed: '暹罗', petType: 'cat' },
    { _id: 'other-pet', _openid: 'other', name: '旧名字', breed: '柯基', petType: 'dog' }
  ];
  const writes = [];
  const db = { command: { in: values => ({ values }) }, collection: name => {
    if (name === 'pd_daily_stats') return { doc: id => ({ update: async update => writes.push({ id, ...update }) }) };
    const query = { where: () => query, orderBy: () => query, skip: () => query, limit: () => query,
      get: async () => ({ data: profiles }) };
    return query;
  } };
  const rows = [{ _id: 'daily-id', owner: ownerHash('app:owner'), name: '旧名字', distance: 123 }];
  const [result] = await enrichLeaderboardPets(db, rows, 'app', ownerHash);
  assert.equal(result.petId, 'real-pet');
  assert.equal(result.petType, 'cat');
  assert.equal(result.name, '旧名字');
  assert.equal(result.distance, 123);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.profileId, 'real-pet');
  assert.equal('distance' in writes[0].data, false);
});

test('头像组件忽略旧请求及销毁后的回包；加载失败只按用户点击重试', async () => {
  let definition;
  const tasks = [];
  vm.runInNewContext(fs.readFileSync('miniprogram/components/pet-avatar/index.js', 'utf8'), {
    Component: value => { definition = value; }, console: { warn() {} },
    require: () => ({ resolveAvatarImage: (id, force) => new Promise(resolve => tasks.push({ id, force, resolve })) })
  });
  const instance = {
    ...definition.methods, properties: { src: BASE + 'corgi.png' }, data: { ...definition.data },
    setData(update) { Object.assign(this.data, update); }
  };
  definition.lifetimes.attached.call(instance);
  instance.properties.src = BASE + 'cat_1.png';
  const second = instance.refreshAvatar();
  tasks[1].resolve('https://example.com/cat.png');
  await second;
  tasks[0].resolve('https://example.com/dog.png');
  await Promise.resolve();
  assert.equal(instance.data.renderUrl, 'https://example.com/cat.png');
  instance.onImageError({ currentTarget: { dataset: { request: instance._request } } });
  assert.equal(instance.data.failed, true);
  assert.equal(tasks.length, 2);
  instance.retry();
  assert.equal(tasks[2].id, BASE + 'cat_1.png');
  assert.equal(tasks[2].force, true);
  definition.lifetimes.detached.call(instance);
  tasks[2].resolve('https://example.com/retry.png');
  await Promise.resolve();
  assert.equal(instance.data.renderUrl, '');
});

function userPage(record) {
  let definition;
  const writes = [];
  const db = {
    command: { remove: () => ({ remove: true }) },
    collection: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ data: record ? [record] : [] }) }) }),
      doc: id => ({ update: async request => writes.push({ id, ...request }) }),
      add: async request => { writes.push(request); return { _id: 'new-pet-id' }; }
    })
  };
  const sandbox = {
    Page: value => { definition = value; },
    require: createRequire(require.resolve('../miniprogram/pages/user/user.js')),
    getApp: () => ({ cloudInitPromise: Promise.resolve(), getIdentity: async () => ({ openid: 'owner' }), cloud: { database: () => db } }),
    wx: { showLoading() {}, hideLoading() {}, showToast() {} }, console
  };
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/user/user.js', 'utf8'), sandbox);
  const page = {
    ...definition, data: structuredClone(definition.data),
    setData(update) { Object.assign(this.data, update); }, fetchLeaderboard() {}
  };
  return { page, writes };
}

test('真实用户页加载猫档案并实时更新；保存删除旧avatarUrl而不保存新计算值', async () => {
  const { page, writes } = userPage({ _id: 'saved-pet', name: '咪咪', petType: 'cat', breed: '柯基', avatarUrl: 'legacy.png' });
  await page.fetchMyProfile();
  assert.match(page.data.profile.avatarUrl, /\/cat_[123]\.png$/);
  const avatar = page.data.profile.avatarUrl;
  page.onInputName({ detail: { value: '改名咪咪' } });
  page.onInputBreed({ detail: { value: '金毛' } });
  assert.equal(page.data.profile.avatarUrl, avatar);
  await page.saveProfile();
  assert.equal(writes[0].data.petType, 'cat');
  assert.equal(writes[0].data.avatarUrl.remove, true);
  assert.equal(page.data.profile.petId, 'saved-pet');
  assert.equal(page.data.profile.avatarUrl, avatar);
});

test('新建档案保存业务字段，生成ID后统一映射且改名不再换头像', async () => {
  const { page, writes } = userPage(null);
  await page.fetchMyProfile();
  page.onInputName({ detail: { value: '新猫猫' } });
  page.onPetTypeChange({ detail: { value: 'cat' } });
  await page.saveProfile();
  assert.equal(writes[0].data.petType, 'cat');
  assert.equal('avatarUrl' in writes[0].data, false);
  assert.equal(page.data.profile.petId, 'new-pet-id');
  const saved = page.data.profile.avatarUrl;
  page.onInputName({ detail: { value: '新名字' } });
  assert.equal(page.data.profile.avatarUrl, saved);
});
