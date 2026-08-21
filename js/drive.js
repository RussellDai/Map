/* ===== drive.js: 实际驾车车程（OSRM 公共服务，与 🧭 路线导航同源，无 Key、不被广告拦截） =====
   悬停提示 / 侧栏清单卡片使用本地估算车程（store.js driveMinutes，零延迟）；
   打开小区编辑弹窗时再向 OSRM 请求真实驾车路线，把徽章里的估算值替换为
   带「导航」标注的实际车程；同一坐标对结果缓存，避免重复请求。
   任何失败（网络受限/被拦截）都静默保留估算值。
   小区与圆心坐标均为 GCJ02，OSRM 需 WGS84，故先反纠偏。 */
const Drive = {
  _cache: new Map(),

  /* 查询两点间实际驾车车程（入参 {lat,lng}，GCJ02）→ Promise<{minutes, km}> */
  minutes(from, to) {
    const key = [from.lat, from.lng, to.lat, to.lng].map(v => v.toFixed(4)).join(',');
    if (this._cache.has(key)) return Promise.resolve(this._cache.get(key));
    const a = GC.gcj02ToWgs84(from.lng, from.lat);
    const b = GC.gcj02ToWgs84(to.lng, to.lat);
    const url = 'https://router.project-osrm.org/route/v1/driving/' +
      a[0].toFixed(6) + ',' + a[1].toFixed(6) + ';' + b[0].toFixed(6) + ',' + b[1].toFixed(6) +
      '?overview=false';
    return fetchJsonTimeout(url, 10000).then(json => {
      const rt = json && json.routes && json.routes[0];
      if (!rt || !isFinite(rt.duration)) throw new Error('no route');
      const r = {
        minutes: Math.max(1, Math.round(rt.duration / 60)),
        km: (rt.distance || 0) / 1000
      };
      this._cache.set(key, r);
      return r;
    });
  }
};