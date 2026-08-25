/* ===== overpass.js: 从 OpenStreetMap 自动加载真实小区 ===== */
const Overpass = (() => {
  const seenIds = new Set();   // 已处理过的 OSM 元素
  const covered = [];          // 已完成加载的视野矩形 [s,w,n,e]
  let loading = false;
  let zoomHinted = false;

  /* POST 请求单个 Overpass 端点；outerSignal 用于竞速时取消较慢的请求 */
  async function postEndpoint(ep, q, ms, outerSignal) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const onAbort = () => ctrl.abort();
    if (outerSignal) outerSignal.addEventListener('abort', onAbort);
    try {
      const resp = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'data=' + encodeURIComponent(q),
        signal: ctrl.signal
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      if (/^\s*</.test(text)) throw new Error('服务繁忙');
      const json = JSON.parse(text);
      if (json && json.elements) return json;
      throw new Error('响应格式错误');
    } finally {
      clearTimeout(t);
      if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
    }
  }

  /* 执行查询。opts.race=true：所有镜像并行竞速取最快（搜索用）；否则按序故障转移 */
  async function runQuery(q, opts) {
    opts = opts || {};
    if (opts.race) {
      const outer = new AbortController();
      let pending = CONFIG.overpassEndpoints.length, done = false, lastErr = null;
      return new Promise((resolve, reject) => {
        CONFIG.overpassEndpoints.forEach(ep => {
          postEndpoint(ep, q, opts.timeoutMs || 35000, outer.signal)
            .then(json => { if (!done) { done = true; outer.abort(); resolve(json); } })
            .catch(e => {
              if (done) return;
              lastErr = e;
              console.warn('Overpass 节点失败:', ep, e.message);
              if (--pending === 0) reject(lastErr || new Error('所有 Overpass 服务均不可用'));
            });
        });
      });
    }
    let lastErr = null;
    for (const ep of CONFIG.overpassEndpoints) {
      try { return await postEndpoint(ep, q, opts.endpointMs || 20000); }
      catch (e) { lastErr = e; console.warn('Overpass 节点失败:', ep, e.message); }
    }
    throw lastErr || new Error('所有 Overpass 服务均不可用');
  }

  function bboxCovered(b) {
    return covered.some(c =>
      b.getSouth() >= c[0] && b.getWest() >= c[1] &&
      b.getNorth() <= c[2] && b.getEast() <= c[3]);
  }

  /* 小区类 POI 的 Overpass 查询 */
  function buildQuery(bbox) {
    return `[out:json][timeout:35];(
      nwr["landuse"="residential"]["name"](${bbox});
      nwr["place"~"suburb|neighbourhood|quarter"]["name"](${bbox});
      nwr["residential"]["name"](${bbox});
      nw["building"~"apartments|residential"]["name"](${bbox});
    );out center 500;`;
  }

  async function loadInView() {
    if (loading || !App.map) return;
    const z = App.map.getZoom();
    if (z < CONFIG.minLoadZoom) {
      if (!zoomHinted) {
        zoomHinted = true;
        showStatus('🔍 放大地图到街道级别（12级以上）后自动加载小区');
        setTimeout(hideStatus, 4000);
      }
      return;
    }
    const b = App.map.getBounds().pad(0.1);
    if (b.getNorth() - b.getSouth() > 0.5 || b.getEast() - b.getWest() > 0.7) return;
    if (bboxCovered(b)) return;

    loading = true;
    showStatus('⏳ 正在自动加载视野内的小区…');
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
      .map(v => v.toFixed(5)).join(',');
    try {
      const json = await runQuery(buildQuery(bbox));
      let added = 0;
      (json.elements || []).forEach(el => {
        const tags = el.tags || {};
        const name = tags.name;
        if (!name) return;
        if (/^\d+(幢|栋|号楼)?$/.test(name)) return; // 单栋楼号
        if (/(购物中心|酒店|银行|工业园|产业园|管委会|加油站)$/.test(name) &&
            !tags.place && tags.landuse !== 'residential') return;
        const id = 'osm-' + el.type + el.id;
        if (seenIds.has(id)) return;
        seenIds.add(id);
        let lat = el.lat, lng = el.lon;
        if (lat == null && el.center) { lat = el.center.lat; lng = el.center.lon; }
        if (lat == null || lng == null) return;
        const stored = Store.get(id); // 之前填过信息的同一 OSM 小区
        let c;
        if (stored) { c = Object.assign({}, stored); }
        else {
          const p = GC.wgs84ToGcj02(lng, lat); // 纠偏后与高德底图对齐
          c = { id: id, name: name, lat: p[1], lng: p[0], source: 'osm' };
        }
        App.records.set(id, c);
        App.addCommunityMarker(c);
        added++;
      });
      covered.push([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
      if (added > 0) {
        showStatus('✅ 已加载 ' + added + ' 个小区，鼠标悬停查看 / 点击填写');
        setTimeout(hideStatus, 3500);
      } else hideStatus();
    } catch (e) {
      console.error(e);
      showStatus('⚠️ 小区自动加载失败（服务繁忙），可使用「手动标记小区」');
      setTimeout(hideStatus, 5000);
    } finally { loading = false; }
  }

  /* ===== 划区域吸附：道路/水系线段缓存 =====
     OSM 为 WGS84，需纠偏到 GCJ02 才能与高德底图对齐 */
  const snap = { segs: [], covered: [], loading: false };

  /* 按视野加载道路+水系几何（静默，不操作状态条；由划区域功能调用）
     返回：新增线段数；-1 表示条件不满足（缩放太小/范围太大/正在加载） */
  async function loadSnapData(bounds, zoom) {
    if (!bounds || zoom < 13) return -1;   /* 低倍视野太大，查询会被限流/超时 */
    const b = bounds.pad(0.2);
    const latSpan = b.getNorth() - b.getSouth(), lngSpan = b.getEast() - b.getWest();
    if (latSpan * lngSpan > 0.02) return -1;
    if (snap.covered.some(c =>
      b.getSouth() >= c[0] && b.getWest() >= c[1] && b.getNorth() <= c[2] && b.getEast() <= c[3])) return 0;
    if (snap.loading) return -1;
    snap.loading = true;
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]
      .map(v => v.toFixed(5)).join(',');
    /* 道路（排除面状广场）+ 水系线（河/运河）+ 水面/河岸面（取其边线） */
    const q = '[out:json][timeout:25];(' +
      'way["highway"]["area"!~"."](' + bbox + ');' +
      'way["waterway"](' + bbox + ');' +
      'way["natural"~"water|riverbank"](' + bbox + ');' +
      ');out geom 1500;';
    try {
      const json = await runQuery(q);
      let added = 0;
      (json.elements || []).forEach(el => {
        const g = el.geometry;
        if (!g || g.length < 2) return;
        const tags = el.tags || {};
        const kind = (tags.waterway || tags.natural) ? 'water' : 'road';
        const name = tags.name || '';
        let prev = null;
        if (el.type === 'way') {
          /* 线：相邻节点连成线段 */
          g.forEach(n => {
            const p = GC.wgs84ToGcj02(n.lon, n.lat);   /* [lng,lat] */
            const pt = [p[1], p[0]];
            if (prev) { snap.segs.push({ a: prev, b: pt, name: name, kind: kind }); added++; }
            prev = pt;
          });
        }
      });
      snap.covered.push([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
      if (snap.segs.length > 60000) snap.segs.splice(0, snap.segs.length - 60000); /* 内存护栏 */
      return added;
    } finally { snap.loading = false; }
  }

  /* 把点吸附到最近的已加载线段上（平面投影近似，容差内返回 {lat,lng,dist,name,kind}） */
  function snapToFeature(latlng, tolMeters) {
    if (!snap.segs.length) return null;
    const cos = Math.cos(latlng.lat * Math.PI / 180);
    const K = 111320, Kx = K * cos;
    const px = latlng.lng * Kx, py = latlng.lat * K;
    let best = null;
    for (let i = 0; i < snap.segs.length; i++) {
      const s = snap.segs[i];
      const ax = s.a[1] * Kx, ay = s.a[0] * K, bx = s.b[1] * Kx, by = s.b[0] * K;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * dx, qy = ay + t * dy;
      const ex = px - qx, ey = py - qy;
      const dist = Math.sqrt(ex * ex + ey * ey);
      if (dist <= tolMeters && (!best || dist < best.dist)) {
        best = { dist: dist, lat: qy / K, lng: qx / Kx, name: s.name, kind: s.kind };
      }
    }
    return best;
  }

  return { runQuery: runQuery, loadInView: loadInView, loadSnapData: loadSnapData, snapToFeature: snapToFeature };
})();
