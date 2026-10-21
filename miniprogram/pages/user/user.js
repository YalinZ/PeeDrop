const { dayKey, DAY, OFFSET } = require('../../utils/walk-math');
const { toPetProfile, normalizePetType } = require('../../utils/pet-avatar');
const { loadUIImages, onUIAssetError } = require('../../services/ui-images');

Page({
  data: {
    uiImages: {},
    profile: toPetProfile({ name: '', breed: '', petType: 'dog', personality: 'e' }),
    savingProfile: false,
    isExist: false,
    docId: '',
    isEditing: true,
    leaderboard: [],
    leaderboardError: '',
    leaderboardDay: ''
  },

  onLoad() {
    this._unloaded = false;
    this._profileLoaded = false;
    this.fetchMyProfile().catch(error => {
      console.error('档案初始化失败', error);
      wx.showToast({ title: '档案加载失败，请检查网络', icon: 'none' });
    });
  },

  onShow() {
    loadUIImages(this, ['dog', 'cat', 'poodle', 'bone', 'trophy']);
    this.boardVisible = true;
    this.fetchLeaderboard();
    clearInterval(this.boardInterval);
    this.boardInterval = setInterval(() => this.fetchLeaderboard(), 30000);
    this.scheduleMidnight();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
  },

  onHide() { this.stopBoardRefresh(); },
  onUIAssetError(event) { return onUIAssetError(this, event); },
  onUnload() { this._unloaded = true; this.stopBoardRefresh(); },

  stopBoardRefresh() {
    this.boardVisible = false;
    this.boardRequest = (this.boardRequest || 0) + 1;
    clearInterval(this.boardInterval);
    clearTimeout(this.midnightTimer);
  },

  scheduleMidnight() {
    clearTimeout(this.midnightTimer);
    if (!this.boardVisible) return;
    const now = Date.now() + (this.serverOffset || 0);
    const wait = DAY - ((now + OFFSET) % DAY) + 50;
    this.midnightTimer = setTimeout(() => {
      // 即使午夜断网也不能继续显示昨日榜。
      this.setData({ leaderboard: [], leaderboardDay: '', leaderboardError: '' });
      this.fetchLeaderboard();
      this.scheduleMidnight();
    }, wait);
  },

  async fetchLeaderboard() {
    const request = this.boardRequest = (this.boardRequest || 0) + 1;
    const day = dayKey(Date.now() + (this.serverOffset || 0));
    if (this.data.leaderboardDay && this.data.leaderboardDay !== day) {
      this.setData({ leaderboard: [], leaderboardDay: '' });
    }
    try {
      const app = getApp();
      await app.cloudInitPromise;
      const response = await app.cloud.callFunction({ name: 'walkStats', data: { action: 'leaderboard' } });
      if (!this.boardVisible || request !== this.boardRequest) return;
      const result = response.result;
      if (!result || !result.success) throw new Error('排行榜查询失败');
      this.serverOffset = result.serverNow - Date.now();
      const board = result.data.map(item => ({
        ...toPetProfile(item, { useDocumentId: false }),
        displayDistance: item.todayDistance >= 1000
          ? (item.todayDistance / 1000).toFixed(2) + ' km'
          : Math.round(item.todayDistance) + ' m'
      }));
      this.setData({ leaderboard: board, leaderboardDay: result.dayKey, leaderboardError: '' });
      this.scheduleMidnight();
    } catch (error) {
      if (!this.boardVisible || request !== this.boardRequest) return;
      console.error('获取排行榜失败', error);
      this.setData({ leaderboard: [], leaderboardError: '排行榜加载失败，请检查网络后重试' });
    }
  },

  async fetchMyProfile() {
    wx.showLoading({ title: '加载中...' });
    try {
      const app = getApp();
      await app.cloudInitPromise;
      if (!app.cloud) throw new Error('云环境未初始化');
      const { openid } = await app.getIdentity();
      const result = await app.cloud.database().collection('pd_users')
        .where({ _openid: openid }).limit(1).get();
      if (this._unloaded) return;
      const userDoc = result.data && result.data[0];
      this._profileLoaded = true;
      if (userDoc) {
        this.setData({
          profile: toPetProfile(userDoc),
          isExist: true, docId: userDoc._id, isEditing: false
        });
      }
    } finally {
      wx.hideLoading();
    }
  },

  editProfile() {
    this.setData({ isEditing: true });
  },

  updatePetProfile(fields) {
    if (this.data.savingProfile) return;
    this.setData({ profile: toPetProfile({ ...this.data.profile, ...fields }) });
  },

  onInputName(e) {
    this.updatePetProfile({ name: e.detail.value });
  },

  onInputBreed(e) {
    this.updatePetProfile({ breed: e.detail.value, petBreed: e.detail.value });
  },

  onPetTypeChange(e) {
    this.updatePetProfile({ petType: normalizePetType(e.detail.value) });
  },

  onPersonalityChange(e) {
    this.updatePetProfile({ personality: e.detail.value });
  },

  async saveProfile() {
    if (this.data.savingProfile) return;
    if (!this._profileLoaded) {
      wx.showToast({ title: '请等待档案加载完成后重试', icon: 'none' });
      return;
    }
    const profile = toPetProfile(this.data.profile);
    if (!profile.name) {
      wx.showToast({ title: '请输入狗狗昵称', icon: 'none' });
      return;
    }
    this.setData({ savingProfile: true });
    wx.showLoading({ title: '保存中...' });
    try {
      const app = getApp();
      await app.cloudInitPromise;
      if (!app.cloud) throw new Error('云环境未初始化');
      const db = app.cloud.database();
      // 仅持久化业务字段，头像URL始终由统一工具计算。
      const data = {
        name: profile.name, breed: profile.breed, petBreed: profile.petBreed,
        petType: profile.petType,
        personality: profile.personality === 'i' ? 'i' : 'e'
      };
      let docId = this.data.docId;
      if (this.data.isExist) {
        await db.collection('pd_users').doc(docId).update({ data: {
          ...data, avatarUrl: db.command.remove()
        } });
      } else {
        const result = await db.collection('pd_users').add({ data });
        docId = result._id;
      }
      if (this._unloaded) return;
      this.setData({
        profile: toPetProfile({ ...profile, ...data, _id: docId }),
        isExist: true, docId, isEditing: false
      });
      // 使用生成后的稳定档案ID重新映射，之后改名不会换随机头像。
      this.fetchLeaderboard();
      wx.showToast({ title: '档案已更新！' });
    } catch (error) {
      console.error('保存档案失败', error);
      if (!this._unloaded) wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      if (!this._unloaded) this.setData({ savingProfile: false });
    }
  }
});
