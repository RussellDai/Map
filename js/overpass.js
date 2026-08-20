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

  return { runQuery: runQuery, loadInView: loadInView };
})();
