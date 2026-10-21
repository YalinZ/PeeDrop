const { resolveAvatarImage } = require('../../services/avatar-images');

Component({
  properties: {
    src: { type: String, value: '', observer() { if (this._alive) this.refreshAvatar(); } },
    petName: { type: String, value: '' }
  },
  data: { renderUrl: '', loading: false, failed: false, request: 0 },
  lifetimes: {
    attached() { this._alive = true; this.refreshAvatar(); },
    detached() { this._alive = false; this._request = (this._request || 0) + 1; }
  },
  methods: {
    async refreshAvatar(force = false) {
      if (!this._alive) return;
      const request = this._request = (this._request || 0) + 1;
      const fileId = this.properties.src;
      this.setData({ renderUrl: '', loading: !!fileId, failed: false, request });
      if (!fileId) return;
      try {
        const url = await resolveAvatarImage(fileId, force);
        if (!this._alive || request !== this._request) return;
        this.setData({ renderUrl: url });
      } catch (error) {
        if (!this._alive || request !== this._request) return;
        console.warn('宠物头像加载失败', error);
        this.setData({ loading: false, failed: true });
      }
    },
    onImageLoad(e) {
      if (this._alive && Number(e.currentTarget.dataset.request) === this._request) {
        this.setData({ loading: false });
      }
    },
    onImageError(e) {
      if (this._alive && Number(e.currentTarget.dataset.request) === this._request) {
        this.setData({ renderUrl: '', loading: false, failed: true });
      }
    },
    retry() { if (this.data.failed) this.refreshAvatar(true); }
  }
});
