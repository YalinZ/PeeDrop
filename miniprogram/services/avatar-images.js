const { AVATAR_BASE_URL } = require('../utils/pet-avatar');
const { UI_ASSETS } = require('../utils/ui-assets');
const uiFiles = new Set(Object.values(UI_ASSETS));
const cache = new Map();
const pending = new Map();
let queued = new Map();
let scheduled = false;
const CACHE_MS = 5 * 60 * 1000;

// 通过项目已有的跨账号 Cloud 实例解析文件ID；链接只在内存中短期缓存。
async function flush() {
  scheduled = false;
  const batch = queued;
  queued = new Map();
  try {
    const app = getApp();
    await app.cloudInitPromise;
    if (!app.cloud) throw new Error('云环境未初始化');
    const response = await app.cloud.getTempFileURL({ fileList: [...batch.keys()] });
    const files = Array.isArray(response.fileList) ? response.fileList : [];
    for (const [fileId, task] of batch) {
      const item = files.find(file => file.fileID === fileId);
      if (!item || (item.status != null && item.status !== 0) ||
          typeof item.tempFileURL !== 'string' || !/^https:\/\//i.test(item.tempFileURL)) {
        const error = new Error((item && item.errMsg) || '云图片文件不可读取');
        pending.delete(fileId);
        task.reject(error);
        continue;
      }
      const ttl = Number.isFinite(item.maxAge) && item.maxAge > 0
        ? Math.min(CACHE_MS, item.maxAge * 1000) : CACHE_MS;
      cache.set(fileId, { url: item.tempFileURL, expiresAt: Date.now() + ttl });
      pending.delete(fileId);
      task.resolve(item.tempFileURL);
    }
  } catch (error) {
    for (const [fileId, task] of batch) {
      pending.delete(fileId);
      task.reject(error);
    }
  }
}

function resolveAvatarImage(fileId, force = false) {
  if (typeof fileId !== 'string' || !fileId.startsWith(AVATAR_BASE_URL) ||
      !/^[a-z0-9_]+\.png$/.test(fileId.slice(AVATAR_BASE_URL.length))) {
    return Promise.reject(new Error('无效头像文件ID'));
  }
  return resolveCachedImage(fileId, force);
}

function resolveUIImage(fileId, force = false) {
  if (!uiFiles.has(fileId)) return Promise.reject(new Error('无效UI素材文件ID'));
  return resolveCachedImage(fileId, force);
}

function resolveCachedImage(fileId, force) {
  if (force) cache.delete(fileId);
  const saved = cache.get(fileId);
  if (saved && saved.expiresAt > Date.now()) return Promise.resolve(saved.url);
  if (pending.has(fileId)) return pending.get(fileId);
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  pending.set(fileId, promise);
  queued.set(fileId, { resolve, reject });
  if (!scheduled) {
    scheduled = true;
    Promise.resolve().then(flush);
  }
  return promise;
}

module.exports = { resolveAvatarImage, resolveUIImage };
