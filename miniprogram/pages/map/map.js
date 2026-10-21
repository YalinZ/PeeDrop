const { toPetProfile } = require('../../utils/pet-avatar');
const MapMarkerLayer = require('../../services/map-marker-layer');
const { loadUIImages, onUIAssetError } = require('../../services/ui-images');
function isValidCoordinate(longitude, latitude) {
  return typeof longitude === 'number' && Number.isFinite(longitude) &&
    typeof latitude === 'number' && Number.isFinite(latitude) &&
    longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
}

Page({
  data: {
    uiImages: {},
    longitude: 116.397428,
    latitude: 39.90923,
    scale: 16,
    isMapReady: false,
    hasProfile: false,
    showActionPanel: false,
    showMiniProfile: false,
    currentProfile: toPetProfile({}),
    markerMessage: '',
    currentMarkerMessage: '',
    markers: [],
    markerOptions: [
      { category: '狗狗状态', items: [{type: 'poop', icon: '💩', text: '拉粑粑'}, {type: 'pee', icon: '💦', text: '尿尿'}, {type: 'edog', icon: '🐕', text: 'e狗求玩'}, {type: 'idog', icon: '🫣', text: 'i狗勿扰'}] },
      // 2. 在危险预警面板中增加猫猫怪物出没
      { category: '危险预警', items: [{type: 'danger', icon: '🛑', text: '烈性犬'}, {type: 'poison', icon: '☠️', text: '有毒物'}, {type: 'police', icon: '🚓', text: '查狗队'}, {type: 'cat', icon: '😼', text: '猫猫怪物出没'}] },
      { category: '地点种草', items: [{type: 'grass', icon: '📍', text: '宝藏草坪'}, {type: 'cafe', icon: '☕', text: '宠物友好'}] }
    ],
    isWalking: false,
    pendingWalk: false,
    totalDistance: 0,
    polyline: []
  },

  onLoad: function (options) {
    this._unloaded = false;
    this.unsubscribeWalk = getApp().walkRecorder.subscribe(state => this.setData(state));
    this.getUserLocation();
  },

  onShow: function () {
    loadUIImages(this, ['bone']);
    this._mapVisible = true;
    const task = getApp().globalData.pendingAddMarker
      ? this.openPendingMarkerPanel()
      : this.checkUserProfile();
    task.catch(error => {
      console.error('地图档案初始化失败', error);
      wx.showToast({ title: '档案加载失败，请检查网络后重试', icon: 'none' });
    });
    getApp().walkRecorder.show();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  onHide: function () {
    this._markersRequest = (this._markersRequest || 0) + 1;
    this._mapVisible = false;
    this._miniProfileRequest = (this._miniProfileRequest || 0) + 1;
    if (this._miniProfileLoading) { wx.hideLoading(); this._miniProfileLoading = false; }
    getApp().globalData.pendingAddMarker = false;
    if (this.regionChangeTimer) {
      clearTimeout(this.regionChangeTimer);
      this.regionChangeTimer = null;
    }
  },

  onUnload: function () {
    if (this.markerLayer) this.markerLayer.dispose();
    this._unloaded = true;
    this._markersRequest = (this._markersRequest || 0) + 1;
    this._mapVisible = false;
    this._miniProfileRequest = (this._miniProfileRequest || 0) + 1;
    if (this._miniProfileLoading) { wx.hideLoading(); this._miniProfileLoading = false; }
    if (this.regionChangeTimer) {
      clearTimeout(this.regionChangeTimer);
    }
    if (this.unsubscribeWalk) this.unsubscribeWalk();
  },

  checkUserProfile: async function () {
    if (this._profileRequest) return this._profileRequest;
    const task = (async () => {
      const app = getApp();
      await app.cloudInitPromise;
      if (!app.cloud) throw new Error('云环境未初始化');
      const { openid } = await app.getIdentity();
      const result = await app.cloud.database().collection('pd_users')
        .where({ _openid: openid }).limit(1).get();
      if (this._mapVisible) {
        this.setData({ hasProfile: !!(result.data && result.data.length) });
      }
      return result;
    })();
    this._profileRequest = task;
    try { return await task; }
    finally {
      if (this._profileRequest === task) this._profileRequest = null;
    }
  },

  // 由地图 onShow 或当前页的中间按钮调用，档案就绪后才打开面板。
  openPendingMarkerPanel: async function () {
    if (this._openingMarker) return this._openingMarker;
    if (!this._mapVisible || !getApp().globalData.pendingAddMarker) return;
    const task = (async () => {
      await this.checkUserProfile();
      const app = getApp();
      if (!this._mapVisible || !app.globalData.pendingAddMarker) return;
      app.globalData.pendingAddMarker = false;
      this.onAddMarkerTap();
    })();
    this._openingMarker = task;
    try { return await task; }
    finally {
      if (this._openingMarker === task) this._openingMarker = null;
    }
  },

  onReady: function () {
    this.mapCtx = wx.createMapContext('myMap', this);
    this.getMarkerLayer().attach(this.mapCtx);
    this.setData({ isMapReady: true });
  },

  getMarkerLayer: function () {
    if (!this.markerLayer) this.markerLayer = new MapMarkerLayer(this);
    return this.markerLayer;
  },

  onUIAssetError: function (event) { return onUIAssetError(this, event); },

  getUserLocation: function () {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        if (this._unloaded) return;
        if (!isValidCoordinate(res.longitude, res.latitude)) {
          console.error('定位结果缺少有效经纬度', res);
          wx.showToast({ title: '定位结果异常，请重新定位', icon: 'none' });
          return;
        }
        this.setData({
          longitude: res.longitude,
          latitude: res.latitude
        });
        this.fetchNearbyMarkers(res.longitude, res.latitude);
      },
      fail: (err) => {
        console.error("获取位置失败:", err);
      }
    });
  },

  onLocateTap: function () {
    if (this.mapCtx) {
      this.mapCtx.moveToLocation();
      this.setData({ scale: 18 });
    }
  },

  onAddMarkerTap: function () {
    if (!this.data.hasProfile) {
      wx.showModal({
        title: '提示',
        content: '请先给修狗建立档案，才能标记地盘和遛狗哦！',
        confirmText: '去建档',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/user/user' });
          }
        }
      });
      return;
    }
    this.setData({
      showActionPanel: true
    });
  },

  closePanel: function () {
    this.setData({
      showActionPanel: false
    });
  },

  onInputMessage: function (e) {
    this.setData({ markerMessage: e.detail.value });
  },

  onSelectMarker: function (e) {
    if (!isValidCoordinate(this.data.longitude, this.data.latitude)) {
      wx.showToast({ title: '位置无效，请重新定位', icon: 'none' });
      return;
    }
    const type = e.currentTarget.dataset.type;
    wx.showLoading({ title: '标记中...' });

    const app = getApp();
    if (!app.cloud) {
      console.error("云环境未初始化");
      wx.hideLoading();
      return;
    }
    const db = app.cloud.database();

    // 3. 将 cat 加入临时状态数组，设定2小时后过期自动消失
    const tempTypes = ['poop', 'pee', 'edog', 'idog', 'cat'];
    const markerData = {
      type: type,
      createTime: db.serverDate(),
      location: new db.Geo.Point(this.data.longitude, this.data.latitude),
      message: this.data.markerMessage
    };

    if (tempTypes.includes(type)) {
      markerData.expireAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    }

    db.collection('pd_markers').add({
      data: markerData,
      success: (res) => {
        wx.hideLoading();
        this.closePanel();
        wx.showToast({ title: '标记成功' });
        this.setData({ markerMessage: '' });
        this.fetchNearbyMarkers();
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('标记失败:', err);
        wx.showToast({ title: '标记失败', icon: 'none' });
      }
    });
  },

  fetchNearbyMarkers: async function (centerLng, centerLat) {
    const longitude = centerLng === undefined ? this.data.longitude : centerLng;
    const latitude = centerLat === undefined ? this.data.latitude : centerLat;
    if (this._unloaded || !isValidCoordinate(longitude, latitude)) {
      return;
    }
    const request = this._markersRequest = (this._markersRequest || 0) + 1;
    try {
      const app = getApp();
      await app.cloudInitPromise;
      if (this._unloaded || request !== this._markersRequest) return;
      if (!app.cloud) {
        console.error("云环境未初始化");
        return;
      }
      const db = app.cloud.database();

      const _ = db.command;

      // 不能只拿默认首批记录：同坐标旧记录较多时，最新打卡可能在下一页。
      const rows = [];
      const pageSize = 100;
      for (let offset = 0; ; offset += pageSize) {
        const res = await db.collection('pd_markers').where({
          location: _.geoNear({
            geometry: new db.Geo.Point(longitude, latitude), maxDistance: 3000
          })
        }).skip(offset).limit(pageSize).get();
        if (this._unloaded || request !== this._markersRequest) return;
        const batch = res.data || [];
        rows.push(...batch);
        if (batch.length < pageSize) break;
      }
      this.getMarkerLayer().setRecords(rows);
    } catch (err) {
      console.error('获取附近标记失败:', err);
    }
  },

  onRegionChange: function (e) {
    if (!this.data.isMapReady) return;

    if (e.type === 'end' || e.type === 'regionchange') {
      if (this.regionChangeTimer) clearTimeout(this.regionChangeTimer);
      this.regionChangeTimer = setTimeout(() => {
        if (this.mapCtx) {
          this.mapCtx.getCenterLocation({
            success: (res) => {
              this.fetchNearbyMarkers(res.longitude, res.latitude);
            },
            fail: (err) => {
              console.error('获取地图中心点失败', err);
            }
          });
        }
      }, 500);
    }
  },

  toggleWalk: async function () {
    if (this.walkBusy) return;
    const recorder = getApp().walkRecorder;
    if (!recorder.session && !this.data.hasProfile) {
      wx.showModal({
        title: '提示', content: '请先给狗狗建立档案', confirmText: '去建档',
        success: res => { if (res.confirm) wx.switchTab({ url: '/pages/user/user' }); }
      });
      return;
    }
    this.walkBusy = true;
    const finishing = !!recorder.session;
    try {
      if (finishing) {
        wx.showLoading({ title: '结算里程中...' });
        const meters = await recorder.finish();
        wx.showModal({ title: '遛狗结束', content: `本次共走过了 ${meters} 米！`, showCancel: false });
      } else {
        await recorder.start();
        wx.showToast({ title: '开始记录遛狗路线', icon: 'none' });
      }
    } catch (error) {
      console.error('遛狗操作失败', error);
      if (finishing) {
        wx.showToast({ title: '进度已保留，请重试提交', icon: 'none' });
      } else {
        wx.showModal({
          title: '未能开始定位',
          content: '已有进度会保留。请检查网络、手机定位服务，以及“使用小程序期间和离开小程序后”的位置权限。',
          confirmText: '去设置',
          success: res => { if (res.confirm) wx.openSetting({}); }
        });
      }
    } finally {
      if (finishing) wx.hideLoading();
      this.walkBusy = false;
    }
  },

  onMarkerTap: async function (e) {
    const markerId = Number(e.detail.markerId);
    if (this.markerLayer && this.markerLayer.tap(markerId)) return;
    const clickedMarker = this.data.markers.find(marker => marker.id === markerId);
    if (!clickedMarker || !clickedMarker.openid) return;
    const request = this._miniProfileRequest = (this._miniProfileRequest || 0) + 1;
    wx.showLoading({ title: '嗅探中...' });
    this._miniProfileLoading = true;
    try {
      const app = getApp();
      await app.cloudInitPromise;
      if (!app.cloud) throw new Error('云环境未初始化');
      const result = await app.cloud.database().collection('pd_users')
        .where({ _openid: clickedMarker.openid }).limit(1).get();
      if (!this._mapVisible || request !== this._miniProfileRequest) return;
      const pet = result.data && result.data[0];
      this.setData({
        currentProfile: toPetProfile(pet || {
          name: '神秘修狗', breed: '未知', personality: '未知'
        }),
        currentMarkerMessage: clickedMarker.message || '',
        showMiniProfile: true
      });
    } catch (error) {
      console.error('获取宠物名片失败', error);
      if (this._mapVisible && request === this._miniProfileRequest) {
        wx.showToast({ title: '名片加载失败，请重试', icon: 'none' });
      }
    } finally {
      if (request === this._miniProfileRequest && this._miniProfileLoading) {
        wx.hideLoading();
        this._miniProfileLoading = false;
      }
    }
  },

  closeMiniProfile: function () {
    this._miniProfileRequest = (this._miniProfileRequest || 0) + 1;
    if (this._miniProfileLoading) { wx.hideLoading(); this._miniProfileLoading = false; }
    this.setData({
      showMiniProfile: false
    });
  }
})
