const { UI_ASSETS } = require('../utils/ui-assets');
const { resolveUIImage } = require('./avatar-images');
const alive = target => !target._unloaded && target._alive !== false;

// 只拉取页面使用的素材；复用头像服务的批量请求、在途去重和短期缓存。
async function loadUIImages(target, keys, force = false) {
  if (!alive(target)) return;
  const versions = target._uiImageVersions || (target._uiImageVersions = {});
  const loaded = {};
  await Promise.all(keys.map(async key => {
    const version = versions[key] = (versions[key] || 0) + 1;
    try {
      const fileID = UI_ASSETS[key];
      if (!fileID) throw new Error('未知UI素材：' + key);
      const url = await resolveUIImage(fileID, force);
      if (alive(target) && versions[key] === version) loaded[key] = { url, version };
    } catch (error) {
      if (alive(target) && versions[key] === version) console.warn('UI素材读取失败', key, error);
    }
  }));
  if (!alive(target)) return;
  // 等待其他图片期间可能发起了新请求，只提交仍有效的结果。
  const update = {};
  for (const [key, entry] of Object.entries(loaded)) {
    if (versions[key] === entry.version) update[key] = entry.url;
  }
  if (Object.keys(update).length) target.setData({ uiImages: { ...target.data.uiImages, ...update } });
}

function onUIAssetError(target, event) {
  const key = event.currentTarget.dataset.asset;
  if (!UI_ASSETS[key] || !alive(target)) return;
  const retries = target._uiImageRetries || (target._uiImageRetries = {});
  // 链接过期可重新解析一次，损坏的文件不无限触发binderror。
  if (retries[key]) return;
  retries[key] = true;
  return loadUIImages(target, [key], true);
}

module.exports = { loadUIImages, onUIAssetError };
