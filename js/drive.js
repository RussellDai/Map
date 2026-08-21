/* ===== drive.js: 高德实际驾车车程（JS API 2.0 AMap.Driving 插件，懒加载） =====
   悬停提示 / 侧栏清单卡片使用本地估算车程（store.js driveMinutes，零延迟）；
   打开小区编辑弹窗时再向高德请求真实驾车路线，把徽章里的估算值替换为
   带「高德」标注的实际车程。任何失败（Key/网络/域名白名单）都静默保留估算值。
   小区与圆心坐标均为 GCJ02，可直接传给高德。 */
const AmapDrive = {
  _driving: null,
  _loading: null,

  /* 懒加载高德脚本（复用 amap3d.js 的加载器）并追加 Driving 插件 */
  _ensure() {
    if (this._driving) return Promise.resolve(this._driving);
    if (this._loading) return this._loading;
    const self = this;
    this._loading = Amap3d.load().then(AMap => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        self._loading = null;
        reject(new Error('高德 Driving 插件加载超时'));
      }, 15000);
      AMap.plugin('AMap.Driving', () => {
        clearTimeout(timer);
        if (window.AMap && window.AMap.Driving) {
          try { self._driving = new AMap.Driving({ hideMarkers: true, policy: 0 }); }
          catch (e) { self._loading = null; reject(e); return; }
          resolve(self._driving);
        } else {
          self._loading = null;
          reject(new Error('高德 Driving 插件不可用'));
        }
      });
    })).catch(e => { self._loading = null; throw e; });
    return this._loading;
  },

  /* 查询两点间实际驾车车程（入参 {lat,lng}，GCJ02）→ Promise<{minutes, km}> */
  minutes(from, to) {
    return this._ensure().then(dr => new Promise((resolve, reject) => {
      const AMap = window.AMap;
      dr.search(
        new AMap.LngLat(from.lng, from.lat),
        new AMap.LngLat(to.lng, to.lat),
        (status, result) => {
          if (status === 'complete' && result && result.routes && result.routes.length) {
            const r = result.routes[0];   // 默认 policy=0 时间最短路线
            resolve({
              minutes: Math.max(1, Math.round((r.time || 0) / 60)),
              km: (r.distance || 0) / 1000
            });
          } else {
            reject(new Error('驾车路线查询失败：' + status));
          }
        });
    }));
  }
};