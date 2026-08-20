/* ===== store.js: 本地持久化（localStorage）与通用工具 ===== */
const Store = {
  data: { communities: {}, centerOverrides: {} },

  load() {
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.communities) this.data = d;
      }
    } catch (e) { console.warn('读取本地数据失败', e); }
    if (!this.data.centerOverrides) this.data.centerOverrides = {};
    if (!this.data.communities) this.data.communities = {};
  },
  save() {
    try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(this.data)); }
    catch (e) { console.warn('保存失败（localStorage 已满或被禁用）', e); }
  },
  upsert(c) { this.data.communities[c.id] = c; this.save(); },
  remove(id) { delete this.data.communities[id]; this.save(); },
  get(id) { return this.data.communities[id]; },
  all() { return Object.values(this.data.communities); }
};

/* 用户是否填写过有效信息 */
function hasInfo(c) {
  return !!(c && (c.price || c.totalPrice || c.pros || c.cons || c.note));
}

/* 两点距离（公里）；入参兼容 [lat,lng] 数组或 L.LatLng 对象 */
function distanceKm(a, b) {
  const pa = Array.isArray(a) ? L.latLng(a[0], a[1]) : L.latLng(a.lat, a.lng);
  const pb = Array.isArray(b) ? L.latLng(b[0], b[1]) : L.latLng(b.lat, b.lng);
  return pa.distanceTo(pb) / 1000;
}
