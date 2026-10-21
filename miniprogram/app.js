const WalkRecorder = require('./services/walk-recorder');
const config = require('./config');

App({
  globalData: {
    env: config.resourceEnv,
    userInfo: null,
    userLocation: null,
    currentPet: null
  },

  onLaunch: function () {
    this.walkRecorder = new WalkRecorder();
    // 1. 激活原生云引擎底座
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return;
    } else {
      wx.cloud.init({ traceUser: true })
    }

    // 2. 实例化跨环境对象
    const cloud = new wx.cloud.Cloud({
      resourceAppid: config.resourceAppid,
      resourceEnv: config.resourceEnv,
    });

    // 3. 关键修复：必须在 init 之前同步挂载到全局，让页面 onLoad/onShow 立刻能拿到实例
    this.cloud = cloud;

    // 4. 异步执行跨账号环境初始化
    this.cloudInitPromise = cloud.init();
  },

  onShow() {
    if (this.walkRecorder && this.cloud) this.walkRecorder.show();
  },

  onHide() {
    if (this.walkRecorder) this.walkRecorder.hide();
  },

  async getIdentity() {
    await this.cloudInitPromise;
    if (!this.identityPromise) {
      this.identityPromise = this.cloud.callFunction({ name: 'walkStats', data: { action: 'identity' } })
        .then(response => {
          if (!response.result || !response.result.openid) throw new Error('身份获取失败');
          return response.result;
        }).catch(error => { this.identityPromise = null; throw error; });
    }
    return this.identityPromise;
  }
})
