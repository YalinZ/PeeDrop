const TAB_PATHS = ['/pages/map/map', '/pages/user/user'];
const { loadUIImages, onUIAssetError } = require('../services/ui-images');

Component({
  data: { selected: 0, uiImages: {} },
  lifetimes: {
    attached() { this._alive = true; this.syncSelected(); loadUIImages(this, ['paw']); },
    detached() { this._alive = false; }
  },
  pageLifetimes: {
    show() { this.syncSelected(); loadUIImages(this, ['paw']); }
  },
  methods: {
    onUIAssetError(event) { return onUIAssetError(this, event); },
    syncSelected() {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const index = page ? TAB_PATHS.indexOf('/' + page.route) : -1;
      if (this._alive && index >= 0) this.setData({ selected: index });
    },

    async switchTab(e) {
      const url = e.currentTarget.dataset.path;
      if (!TAB_PATHS.includes(url) || this._navigating) return;
      this._navigating = true;
      try {
        await new Promise((resolve, reject) => {
          wx.switchTab({ url, success: resolve, fail: reject });
        });
        this.syncSelected();
      } catch (error) {
        console.error('切换页面失败', error);
        wx.showToast({ title: '打开页面失败，请重试', icon: 'none' });
      } finally {
        this._navigating = false;
      }
    },

    async onAddMarker() {
      if (this._navigating) return;
      this._navigating = true;
      const app = getApp();
      app.globalData.pendingAddMarker = true;
      try {
        const pages = getCurrentPages();
        const page = pages[pages.length - 1];
        if (page && page.route === 'pages/map/map' &&
            typeof page.openPendingMarkerPanel === 'function') {
          await page.openPendingMarkerPanel();
        } else {
          // 地图页 onShow 在档案就绪后消费打卡意图，不猜测加载耗时。
          await new Promise((resolve, reject) => {
            wx.switchTab({ url: TAB_PATHS[0], success: resolve, fail: reject });
          });
        }
      } catch (error) {
        app.globalData.pendingAddMarker = false;
        console.error('打开打卡面板失败', error);
        wx.showToast({ title: '打开打卡失败，请检查网络后重试', icon: 'none' });
      } finally {
        this._navigating = false;
      }
    }
  }
});
