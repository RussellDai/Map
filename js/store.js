/* ===== store.js: 本地持久化（localStorage）与通用工具 ===== */
/* 默认生活圈种子数据（首次使用 /「恢复默认两圈」） */
function defaultCircles() {
  return CONFIG.centers.map(cfg => {
    const p = GC.wgs84ToGcj02(cfg.wgs84[0], cfg.wgs84[1]);
    return { key: cfg.key, name: cfg.name, color: cfg.color, radius: cfg.radius, lat: p[1], lng: p[0], builtin: true };
  });
}

const Store = {
  data: { communities: {}, circles: null, centerOverrides: {} },

  load() {
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.communities) this.data = d;
      }
    } catch (e) { console.warn('读取本地数据失败', e); }
    if (!this.data.centerOverrides) this.data.centerOverrides = {};
    if (!this.data.radiusOverrides) this.data.radiusOverrides = {};
    if (!this.data.communities) this.data.communities = {};
    /* 圆圈数据迁移：旧版只有 centerOverrides/radiusOverrides，升级为统一的 circles 数组。
       仅当 circles 键缺失时才迁移；空数组是用户主动删除全部圆圈的结果，予以保留。 */
    if (!Array.isArray(this.data.circles)) {
      const seeded = defaultCircles();
      seeded.forEach(rec => {
        const ov = this.data.centerOverrides && this.data.centerOverrides[rec.key];
        if (Array.isArray(ov) && isFinite(ov[0]) && isFinite(ov[1])) { rec.lat = ov[0]; rec.lng = ov[1]; }
        const r = this.data.radiusOverrides && this.data.radiusOverrides[rec.key];
        if (isFinite(+r) && +r > 0) rec.radius = (+r) * 1000;
      });
      this.data.circles = seeded;
    }
    this.data.circles = this.data.circles.filter(c =>
      c && c.key && c.name && isFinite(+c.lat) && isFinite(+c.lng) && isFinite(+c.radius) && +c.radius > 0);
  },
  save() {
    try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(this.data)); }
    catch (e) { console.warn('保存失败（localStorage 已满或被禁用）', e); return false; }
    if (window.Sync) Sync.schedulePush(); /* 已登录时防抖自动推送云端 */
    return true;
  },
  /* 静默写入（云同步拉取覆盖时使用，不触发再次推送） */
  _persist() {
    try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(this.data)); return true; }
    catch (e) { console.warn('保存失败', e); return false; }
  },
  /* 回读校验：确认数据真正写入（隐私/无痕模式、禁用存储的浏览器会静默丢失） */
  verify() {
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (!raw) return 0;
      const d = JSON.parse(raw);
      return d && d.communities ? Object.keys(d.communities).length : 0;
    } catch (e) { return 0; }
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

/* ===== 车程估算：直线距离 × 道路绕行系数 ÷ 分段平均车速。
   悬停提示与侧栏清单卡片即时展示用（零延迟、无网络依赖）；
   编辑弹窗打开后会再用 OSRM 实际驾车路线替换（见 drive.js）。 ===== */
const DRIVE_DETOUR = 1.2;   // 城市道路绕行系数（直线 → 实际行驶里程）
function driveMinutes(km) {
  /* 分段车速：短途纯城区、中途混合、长途含快速路/高速，贴近实测 */
  const speed = km < 5 ? 35 : km < 15 ? 45 : 60;
  return Math.max(1, Math.round(km * DRIVE_DETOUR / speed * 60));
}
