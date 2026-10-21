const { distance, addSegment } = require('../utils/walk-math');
const META = 'liuweier.walk.v1';
const CHUNK_SIZE = 200;
const MAX_GAP = 60000;

class WalkRecorder {
  constructor() {
    this.session = null;
    this.points = [];
    this.listeners = new Set();
    this.listening = false;
    this.breakNext = true;
    this.onLocation = this.onLocation.bind(this);
    this.restore();
  }

  chunkKey(index) { return `${META}.${this.session.id}.${index}`; }

  restore() {
    try {
      const meta = wx.getStorageSync(META);
      if (!meta) return;
      if (meta.version !== 1 || !Number.isInteger(meta.pointCount) || meta.pointCount < 0) {
        throw new Error('不支持的轨迹存档');
      }
      this.session = meta;
      for (let i = 0; i < Math.ceil(meta.pointCount / CHUNK_SIZE); i++) {
        const chunk = wx.getStorageSync(this.chunkKey(i));
        if (!Array.isArray(chunk)) throw new Error('轨迹分片缺失');
        this.points.push(...chunk);
      }
      this.points = this.points.slice(0, meta.pointCount);
      if (this.points.length !== meta.pointCount) throw new Error('轨迹分片不完整');
      this.breakNext = true; // 冷启动后绝不连接失联前后的坐标。
    } catch (error) {
      this.session = null;
      this.points = [];
      this.storageError = error;
      // 不覆盖损坏存档，等待用户处理，避免静默丢失。
      console.error('轨迹恢复失败', error);
    }
  }

  persist() {
    if (!this.session) return;
    if (this.points.length) {
      const index = Math.floor((this.points.length - 1) / CHUNK_SIZE);
      wx.setStorageSync(this.chunkKey(index), this.points.slice(index * CHUNK_SIZE));
    }
    // 先写点，再写元数据；被回收时至多忽略未提交的尾点。
    wx.setStorageSync(META, this.session);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    const segments = [];
    let segment = [];
    this.points.forEach(point => {
      if (point.breakBefore && segment.length) {
        if (segment.length >= 2) segments.push(segment);
        segment = [];
      }
      segment.push({ latitude: point.latitude, longitude: point.longitude });
    });
    if (segment.length >= 2) segments.push(segment);
    return {
      isWalking: !!this.session && this.session.status === 'active',
      pendingWalk: !!this.session && this.session.status === 'pending',
      totalDistance: this.session ? Math.round(this.session.totalDistance) : 0,
      trackInterrupted: this.points.some(point => point.breakBefore && point !== this.points[0]),
      polyline: segments.map(points => ({ points, color: '#6CC062', width: 6, arrowLine: true }))
    };
  }

  emit() { this.listeners.forEach(listener => listener(this.snapshot())); }

  async start() {
    if (this.storageError) throw new Error('轨迹存档异常，请先保留存档并联系开发者');
    if (this.session) throw new Error('请先结束或重试提交上次遛狗');
    this.session = {
      version: 1, id: `w${Date.now()}${Math.random().toString(36).slice(2, 12)}`,
      startedAt: Date.now(), status: 'active', pointCount: 0,
      revision: 0, totalDistance: 0, dailyDistances: {}
    };
    this.points = [];
    this.breakNext = true;
    try {
      this.persist(); // 未成功存档时不开始录制。
    } catch (error) {
      this.session = null;
      throw error;
    }
    this.emit();
    await this.resume();
  }

  async resume() {
    if (!this.session || this.session.status !== 'active' || this.listening) return;
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      // 在启动前绑定一次，页面卸载不会解绑应用级监听。
      wx.onLocationChange(this.onLocation);
      wx.startLocationUpdateBackground({
        type: 'gcj02',
        success: () => { this.listening = true; resolve(); },
        fail: error => { wx.offLocationChange(this.onLocation); reject(error); }
      });
    });
    try { await this.starting; } finally { this.starting = null; }
  }

  onLocation(location) {
    if (!this.session || this.session.status !== 'active' || this.storageError) return;
    const { latitude, longitude, accuracy } = location;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
        (Number.isFinite(accuracy) && (accuracy < 0 || accuracy > 50))) return;
    const point = { latitude, longitude, timestamp: Date.now(), breakBefore: this.breakNext };
    const last = this.points[this.points.length - 1];
    let meters = 0;
    if (last) {
      const elapsed = point.timestamp - last.timestamp;
      if (elapsed <= 0) return;
      if (elapsed > MAX_GAP) point.breakBefore = true;
      if (!point.breakBefore) {
        meters = distance(last, point);
        if (meters < 3) return; // 减少静止抖动，不推进距离锚点。
        if (meters / (elapsed / 1000) > 8) {
          this.breakNext = true;
          return;
        }
      }
    }
    const previous = JSON.parse(JSON.stringify(this.session));
    if (last && !point.breakBefore) {
      addSegment(this.session.dailyDistances, last.timestamp, point.timestamp, meters);
      this.session.totalDistance += meters;
    }
    this.points.push(point);
    this.session.pointCount = this.points.length;
    this.session.revision++;
    try {
      this.persist();
    } catch (error) {
      this.points.pop();
      this.session = previous;
      this.storageError = error;
      this.stopLocation();
      wx.showToast({ title: '存储失败，已停止采集，请释放空间后重试', icon: 'none' });
      return;
    }
    this.breakNext = false;
    this.emit();
    if (Date.now() - (this.lastSyncAt || 0) >= 15000) {
      this.sync().catch(error => console.warn('轨迹统计待重试', error));
    }
  }

  stopLocation() {
    wx.offLocationChange(this.onLocation);
    wx.stopLocationUpdate({});
    this.listening = false;
    this.breakNext = true;
  }

  async sync() {
    if (!this.session) return;
    if (this.syncing) {
      await this.syncing;
      return this.sync(); // 上一请求可能只包含旧版本，继续提交最新快照。
    }
    if (this.lastSyncedId === this.session.id && this.lastSyncedRevision === this.session.revision &&
        this.session.status === 'active') return;
    const snapshot = JSON.parse(JSON.stringify(this.session));
    this.syncing = (async () => {
      const app = getApp();
      await app.cloudInitPromise;
      const response = await app.cloud.callFunction({ name: 'walkStats', data: {
        action: 'sync', session: snapshot
      } });
      if (!response.result || !response.result.success) throw new Error('云端提交失败');
      this.lastSyncAt = Date.now();
      this.lastSyncedId = snapshot.id;
      this.lastSyncedRevision = snapshot.revision;
      if (snapshot.status === 'pending' && this.session && this.session.id === snapshot.id) {
        // 只有云端确认结算成功后才能清理本地记录。
        wx.removeStorageSync(META);
        for (let i = 0; i < Math.ceil(snapshot.pointCount / CHUNK_SIZE); i++) {
          try { wx.removeStorageSync(this.chunkKey(i)); } catch (error) { console.warn(error); }
        }
        this.session = null;
        this.points = [];
        this.storageError = null;
        this.emit();
      }
    })();
    try { await this.syncing; } finally { this.syncing = null; }
  }

  async finish() {
    if (!this.session) return 0;
    if (this.starting) await this.starting.catch(() => {});
    this.stopLocation();
    const total = Math.round(this.session.totalDistance);
    if (this.session.status !== 'pending') {
      this.session.status = 'pending';
      this.session.endedAt = Date.now();
      this.session.revision++;
      this.persist();
    }
    this.emit();
    await this.sync();
    return total;
  }

  hide() {
    if (!this.session) return;
    try { this.persist(); } catch (error) { console.error('后台存档失败', error); }
    // 后台网络请求仅尽力提交，恢复逻辑不依赖它成功。
    this.sync().catch(error => console.warn('云端统计待恢复后重试', error));
  }

  show() {
    if (!this.session) return;
    this.sync().catch(error => console.warn('云端统计待重试', error));
    this.resume().catch(error => {
      console.error('恢复后台定位失败', error);
      wx.showToast({ title: '进度已保留，请检查后台定位权限', icon: 'none' });
    });
  }
}

module.exports = WalkRecorder;
