/* ===== ui.js: 界面交互（提示、编辑窗、侧栏、搜索、导入导出） ===== */
function $(id) { return document.getElementById(id); }

function toast(msg, type) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show ' + (type || '');
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = 'hidden'; }, 2600);
}
function showStatus(msg) { const s = $('statusBar'); s.textContent = msg; s.className = 'show'; }
function hideStatus() { $('statusBar').className = 'hidden'; }
function debounce(fn, ms) {
  let h; return function () { clearTimeout(h); h = setTimeout(() => fn.apply(null, arguments), ms); };
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

/* ---- 分级与街景 ---- */
function levelOf(c) { return CONFIG.levels.find(l => l.key === (c && c.level)); }
function openStreetView(c) {
  if (!c || !isFinite(+c.lat) || !isFinite(+c.lng)) { toast('该小区缺少有效坐标', 'error'); return; }
  /* 地图坐标是 GCJ02，街景影像用 WGS84，反向纠偏后再打开 */
  const w = GC.gcj02ToWgs84(c.lng, c.lat);
  const url = CONFIG.streetViewUrl
    .replace('{lat}', w[1].toFixed(6)).replace('{lng}', w[0].toFixed(6));
  const win = window.open(url, '_blank');
  /* 兼容 Mapillary 已迁移新域名的情况：5 秒后自动在新窗口跳转，无需再点一次 */
  if (win) {
    try {
      win.setTimeout(() => {
        if (!win.closed) win.location.href = url.replace('://www.mapillary.com/', '://labs.mapillary.com/');
      }, 5000);
    } catch (e) { /* 被浏览器拦截则忽略 */ }
    toast('若街景页面空白，稍等约5秒会自动跳转到新版页面');
  }
}

/* ---- 悬停提示内容 ---- */
function tooltipHTML(c) {
  let h = '<div class="tip-name">' + escHtml(c.name) + '</div>';
  const lv = levelOf(c);
  if (lv) h += '<div class="tip-row"><span class="lv-badge lv-' + lv.key + '">' + lv.name + '</span></div>';
  if (hasInfo(c)) {
    if (c.price) {
      h += '<div class="tip-row">💰 单价 <b>' + escHtml(c.price) + '</b> 元/㎡' +
        (c.totalPrice ? ' · 总价 ' + escHtml(c.totalPrice) + '万' : '') + '</div>';
    }
    if (c.pros) h += '<div class="tip-row good">👍 ' + escHtml(truncate(c.pros, 40)) + '</div>';
    if (c.cons) h += '<div class="tip-row bad">👎 ' + escHtml(truncate(c.cons, 40)) + '</div>';
    if (c.note) h += '<div class="tip-row">📌 ' + escHtml(truncate(c.note, 30)) + '</div>';
    h += '<div class="tip-hint">点击修改详情</div>';
  } else {
    h += '<div class="tip-hint">点击填写该小区的优劣与价格</div>';
  }
  return h;
}

/* ---- 点击小区打开编辑窗 ---- */
function openEditor(id) {
  const c = App.records.get(id);
  if (!c) return;
  const div = document.createElement('div');
  div.className = 'editor';
  const LV_ICON = { focus: '🔴', backup: '🔵', exclude: '⚫' };
  const lvBtns = CONFIG.levels.map(l =>
    '<button type="button" data-lv="' + l.key + '">' + (LV_ICON[l.key] || '') + ' ' + l.name + '</button>').join('');
  div.innerHTML =
    '<div class="editor-title">📝 小区信息</div>' +
    '<div class="editor-levels" id="f-levels">' + lvBtns + '</div>' +
    '<label>小区名称<input type="text" id="f-name"></label>' +
    '<div class="editor-row">' +
    '  <label>单价(元/㎡)<input type="number" step="100" id="f-price" placeholder="如 12000"></label>' +
    '  <label>总价(万)<input type="text" id="f-total" placeholder="如 80-120"></label>' +
    '</div>' +
    '<label>优点<textarea id="f-pros" rows="2" placeholder="学区、地铁、环境、物业…"></textarea></label>' +
    '<label>缺点<textarea id="f-cons" rows="2" placeholder="噪音、房龄老、高压线…"></textarea></label>' +
    '<label>备注<textarea id="f-note" rows="2" placeholder="看房记录、中介电话…"></textarea></label>' +
    '<div class="editor-dist" id="f-dist"></div>' +
    '<div class="editor-btns">' +
    '  <button class="btn primary" id="f-save">💾 保存</button>' +
    '  <button class="btn" id="f-street">🌐 街景</button>' +
    '  <button class="btn" id="f-3d">🏙 3D实景</button>' +
    '  <button class="btn danger" id="f-del">🗑 删除</button>' +
    '  <button class="btn" id="f-cancel">关闭</button>' +
    '</div>';
  const popup = L.popup({ maxWidth: 360, minWidth: 300, className: 'editor-popup' })
    .setLatLng([c.lat, c.lng]).setContent(div);
  App.map.openPopup(popup);
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  $('f-name').value = c.name || '';
  $('f-price').value = c.price || '';
  $('f-total').value = c.totalPrice || '';
  $('f-pros').value = c.pros || '';
  $('f-cons').value = c.cons || '';
  $('f-note').value = c.note || '';

  /* 先绑定按钮事件，再填充距离等展示内容（避免中途异常导致按钮失灵） */
  $('f-save').onclick = () => {
    c.name = $('f-name').value.trim() || '未命名小区';
    c.price = $('f-price').value.trim();
    c.totalPrice = $('f-total').value.trim();
    c.pros = $('f-pros').value.trim();
    c.cons = $('f-cons').value.trim();
    c.note = $('f-note').value.trim();
    c.updateTime = Date.now();
    Store.upsert(Object.assign({}, c));
    App.refreshMarkerStyle(id);
    renderSidebar();
    toast('已保存 ✅');
    App.map.closePopup();
  };
  $('f-del').onclick = () => {
    if (!confirm('确定删除该小区标记及其全部信息？')) return;
    App.removeCommunity(id);
    App.map.closePopup();
    toast('已删除');
  };
  $('f-cancel').onclick = () => {
    if (c.source === 'manual' && !hasInfo(c) && !Store.get(id)) App.removeCommunity(id);
    App.map.closePopup();
  };

  /* 分级按钮：点选设置，再点取消，立即保存 */
  const syncLevelUI = () => {
    const cur = (App.records.get(id) || {}).level || '';
    div.querySelectorAll('#f-levels button').forEach(b =>
      b.classList.toggle('active', b.dataset.lv === cur));
  };
  div.querySelectorAll('#f-levels button').forEach(btn => {
    btn.onclick = () => {
      const rec = App.records.get(id);
      if (!rec) return;
      App.setLevel(id, rec.level === btn.dataset.lv ? '' : btn.dataset.lv);
      syncLevelUI();
    };
  });
  syncLevelUI();
  $('f-street').onclick = () => openStreetView(App.records.get(id));
  $('f-3d').onclick = () => Amap3d.open(App.records.get(id));

  /* 距离徽章（放在按钮绑定之后，异常不影响保存） */
  $('f-dist').innerHTML = Object.values(App.centers).map(ct => {
    const d = distanceKm([c.lat, c.lng], ct.latlng);
    const inR = d <= ct.cfg.radius / 1000;
    return '<span class="dist-badge" style="border-color:' + ct.cfg.color + ';color:' + ct.cfg.color + '">' +
      (inR ? '✓' : '✗') + ' 距' + ct.cfg.name + ' ' + d.toFixed(1) + 'km' +
      (inR ? '（圈内）' : '') + '</span>';
  }).join('');
}
/* ---- 侧栏清单 ---- */
function renderSidebar() {
  const list = $('communityList');
  list.innerHTML = '';
  const fB = $('fltBoth').checked, fY = $('fltYaoguan').checked, fJ = $('fltJintan').checked;
  const fLv = $('fltLevel').value;
  let items = Store.all();
  if (fLv === 'none') items = items.filter(c => !c.level);
  else if (fLv) items = items.filter(c => c.level === fLv);
  /* 排序：重点关注 > 备选 > 未分级 > 排除；同级按更新时间倒序 */
  const lvRank = c => (c.level === 'focus' ? 0 : c.level === 'backup' ? 1 : c.level === 'exclude' ? 3 : 2);
  items.sort((a, b) => lvRank(a) - lvRank(b) || (b.updateTime || 0) - (a.updateTime || 0));
  const withDist = items.map(c => {
    const d = {};
    Object.values(App.centers).forEach(ct => { d[ct.cfg.key] = distanceKm([c.lat, c.lng], ct.latlng); });
    return { c: c, d: d };
  });
  const filtered = withDist.filter(x => {
    const inMap = {};
    Object.values(App.centers).forEach(ct => {
      inMap[ct.cfg.key] = x.d[ct.cfg.key] <= ct.cfg.radius / 1000;
    });
    if (fB) return Object.values(inMap).every(v => v);
    if (fY) return inMap.yaoguan;
    if (fJ) return inMap.jintan;
    return true;
  });
  $('countBadge').textContent = items.length;
  if (!filtered.length) {
    list.innerHTML = items.length
      ? '<div class="empty">共有 ' + items.length + ' 个小区，但都被当前筛选条件隐藏了。<br>请取消上方勾选/等级筛选后查看。</div>'
      : '<div class="empty">还没有已保存的小区。<br>放大地图自动加载周边小区，<br>或点「➕ 手动标记小区」「⬆ 导入」添加。<br><small>数据保存在当前浏览器的本地存储中</small></div>';
    return;
  }
  filtered.forEach(x => {
    const c = x.c, d = x.d;
    const lv = levelOf(c);
    const card = document.createElement('div');
    card.className = 'card' + (lv ? ' lv-' + lv.key : '');
    let badges = Object.values(App.centers).map(ct => {
      const dd = d[ct.cfg.key], inR = dd <= ct.cfg.radius / 1000;
      return '<span class="badge ' + (inR ? 'in' : 'out') + '">' +
        ct.cfg.name + ' ' + dd.toFixed(1) + 'km</span>';
    }).join('');
    const lvDots = CONFIG.levels.map(l =>
      '<button class="lv-dot lv-dot-' + l.key + (c.level === l.key ? ' active' : '') +
      '" data-act="lv" data-lv="' + l.key + '" title="设为「' + l.name + '」（再点一次取消）"></button>').join('');
    card.innerHTML =
      '<div class="card-head"><span class="card-name">' +
      (lv ? '<span class="lv-badge lv-' + lv.key + '">' + lv.name + '</span>' : '') +
      escHtml(c.name) + '</span>' +
      '<span class="card-price">' + (c.price ? escHtml(c.price) + '元/㎡' : '') + '</span></div>' +
      '<div class="card-badges">' + badges + '</div>' +
      (c.pros ? '<div class="card-line good">👍 ' + escHtml(truncate(c.pros, 30)) + '</div>' : '') +
      (c.cons ? '<div class="card-line bad">👎 ' + escHtml(truncate(c.cons, 30)) + '</div>' : '') +
      '<div class="card-levels">' + lvDots +
      '<button class="lv-street" data-act="street" title="查看该位置街景（Mapillary）">🌐 街景</button>' +
      '<button class="lv-street" data-act="3d" title="查看该位置高德 3D 实景">🏙 3D</button></div>' +
      '<div class="card-btns">' +
      '<button data-act="go">📍 定位</button>' +
      '<button data-act="edit">✏️ 编辑</button>' +
      '<button data-act="del">🗑 删除</button></div>';
    card.querySelectorAll('[data-act=lv]').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        App.setLevel(c.id, c.level === btn.dataset.lv ? '' : btn.dataset.lv);
      };
    });
    card.querySelector('[data-act=street]').onclick = e => {
      e.stopPropagation(); openStreetView(App.records.get(c.id));
    };
    card.querySelector('[data-act=3d]').onclick = e => {
      e.stopPropagation(); Amap3d.open(App.records.get(c.id) || c);
    };
    card.querySelector('[data-act=go]').onclick = e => {
      e.stopPropagation(); App.map.flyTo([c.lat, c.lng], 15);
    };
    card.querySelector('[data-act=edit]').onclick = e => {
      e.stopPropagation(); App.map.flyTo([c.lat, c.lng], 15);
      setTimeout(() => openEditor(c.id), 500);
    };
    card.querySelector('[data-act=del]').onclick = e => {
      e.stopPropagation();
      if (confirm('确定删除「' + c.name + '」？')) App.removeCommunity(c.id);
    };
    card.onclick = () => App.map.flyTo([c.lat, c.lng], 15);
    list.appendChild(card);
  });
}

/* ---- 地名/小区搜索：本地即时 + Photon/Nominatim 地理编码 + Overpass 深搜兜底 ---- */
let searchToken = 0;
const searchCache = new Map();

function fetchJsonTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .finally(() => clearTimeout(t));
}

/* 常州优先：bbox S,W,N,E 数值、中心点、viewbox，用于搜索排序与地理编码偏好 */
function czBounds() { return CONFIG.czBBox.split(',').map(Number); }
function czCenter() { const b = czBounds(); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
function czViewBox() { const b = czBounds(); return [b[1], b[2], b[3], b[0]].join(','); }
function inChangzhou(lat, lng) {
  const b = czBounds();
  return isFinite(lat) && isFinite(lng) &&
    lat >= b[0] && lng >= b[1] && lat <= b[2] && lng <= b[3];
}

/* 结果行重排：本地已保存 > 常州范围内/地址含常州 > 其他地区（稳定排序） */
function sortSearchRows(box) {
  const st = box.querySelector('.sr-status');
  const items = Array.prototype.slice.call(box.querySelectorAll('.sr-item:not(.sr-status)'));
  items.sort((a, b) =>
    ((+b.dataset.local || 0) - (+a.dataset.local || 0)) ||
    ((+b.dataset.cz || 0) - (+a.dataset.cz || 0)));
  items.forEach(it => box.insertBefore(it, st));
}

/* 搜索地图上已加载/已保存的小区，返回条数 */
function renderLocalHits(box, kw) {
  let n = 0;
  App.records.forEach(c => {
    if (n < 8 && c.name && c.name.indexOf(kw) >= 0) {
      addSearchRow(box, c.name, hasInfo(c) ? '已保存信息的小区' : '已加载小区', c.lat, c.lng, true, true);
      n++;
    }
  });
  return n;
}

/* 添加一条搜索结果。isGcj 表示 lat/lng 是否已是 GCJ02 坐标 */
function addSearchRow(box, name, sub, lat, lng, isGcj, isLocal) {
  if (!box._seen) box._seen = new Set();
  const key = name + lat.toFixed(3) + lng.toFixed(3);
  if (box._seen.has(key)) return;
  box._seen.add(key);
  const p = isGcj ? [lng, lat] : GC.wgs84ToGcj02(lng, lat);
  const item = document.createElement('div');
  item.className = 'sr-item';
  item.dataset.local = isLocal ? '1' : '0';
  item.dataset.cz = (inChangzhou(p[1], p[0]) || /常州/.test(String(name || '') + String(sub || ''))) ? '1' : '0';
  item.innerHTML = '<span class="sr-name">' + escHtml(name) +
    (sub ? '<span class="sr-sub">' + escHtml(sub) + '</span>' : '') +
    '</span><button class="sr-add" title="在此处标记为我的小区">＋标记</button>';
  item.onclick = () => {
    App.map.flyTo([p[1], p[0]], 15);
    App.showSearchPin([p[1], p[0]], name);
    box.className = 'search-results hidden';
  };
  item.querySelector('.sr-add').onclick = e => {
    e.stopPropagation();
    App.addManualAt(p[1], p[0], name);
    box.className = 'search-results hidden';
  };
  const st = box.querySelector('.sr-status');
  if (st) box.insertBefore(item, st); else box.appendChild(item);
}

function setSearchStatus(box, txt) {
  let s = box.querySelector('.sr-status');
  if (!s) { s = document.createElement('div'); s.className = 'sr-item sr-status'; box.appendChild(s); }
  s.textContent = txt;
}

/* 完整搜索（按钮/回车） */
async function doSearch() {
  const kw = $('searchInput').value.trim();
  if (!kw) return;
  const my = ++searchToken;
  const box = $('searchResults');
  box.className = 'search-results';
  box.innerHTML = '';
  const localN = renderLocalHits(box, kw);

  if (searchCache.has(kw)) {
    searchCache.get(kw).forEach(r => addSearchRow(box, r[0], r[1], r[2], r[3], false));
    sortSearchRows(box);
    setSearchStatus(box, '✅（缓存结果）点击行定位，「＋标记」加为小区');
    return;
  }
  if (!navigator.onLine) { setSearchStatus(box, '⚠️ 无网络，仅显示本地结果'); return; }

  const hits = [];
  const collect = (name, sub, lat, lng) => { hits.push([name, sub, lat, lng]); addSearchRow(box, name, sub, lat, lng, false); };

  /* ① Photon 地理编码（通常 1~2 秒） */
  setSearchStatus(box, localN ? '↑ 本地匹配；正在联网搜索…' : '🔍 正在联网搜索（Photon 地理编码）…');
  try {
    const czc = czCenter();  // 以常州中心做位置偏好，同名地点优先返回常州（注意：Photon lang 仅支持 default/de/en/fr，勿加 zh）
    const json = await fetchJsonTimeout('https://photon.komoot.io/api/?q=' + encodeURIComponent(kw) +
      '&limit=10&lat=' + czc[0].toFixed(4) + '&lon=' + czc[1].toFixed(4), 8000);
    if (my !== searchToken) return;
    ((json && json.features) || []).forEach(f => {
      const pp = (f && f.properties) || {};
      if (!pp.name || !f.geometry || !f.geometry.coordinates) return;
      collect(pp.name, [pp.district, pp.city, pp.state].filter(Boolean).join(' '),
        f.geometry.coordinates[1], f.geometry.coordinates[0]);
    });
    sortSearchRows(box);  // 常州结果置顶
  } catch (e) { console.warn('Photon 不可用:', e.message); }

  /* ② Nominatim 地理编码备用 */
  if (!hits.length) {
    setSearchStatus(box, '🔍 换用 Nominatim 地理编码…');
    try {
      const json = await fetchJsonTimeout(
        'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&accept-language=zh-CN' +
        '&viewbox=' + czViewBox() + '&bounded=0&q=' + encodeURIComponent(kw), 8000);
      if (my !== searchToken) return;
      (json || []).forEach(r => {
        const nm = r.name || (r.display_name || '').split(',')[0];
        if (nm) collect(nm, r.display_name, parseFloat(r.lat), parseFloat(r.lon));
      });
      sortSearchRows(box);  // 常州结果置顶
    } catch (e) { console.warn('Nominatim 不可用:', e.message); }
  }

  /* ③ Overpass 深搜兜底（多镜像并行竞速取最快） */
  if (!hits.length) {
    setSearchStatus(box, '🔍 地理编码不可用，Overpass 深度搜索中（10~30秒）…');
    try {
      const esc = kw.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
      const q = '[out:json][timeout:20];nwr["name"~"' + esc + '"](' + CONFIG.czBBox + ');out center 30;';
      const json = await Overpass.runQuery(q, { race: true, timeoutMs: 35000 });
      if (my !== searchToken) return;
      (json.elements || []).forEach(el => {
        const tags = el.tags || {};
        if (!tags.name) return;
        let lat = el.lat, lng = el.lon;
        if (lat == null && el.center) { lat = el.center.lat; lng = el.center.lon; }
        if (lat == null || lng == null) return;
        collect(tags.name, '', lat, lng);
      });
      sortSearchRows(box);
    } catch (e) { console.warn('Overpass 搜索失败:', e.message); }
  }

  if (my !== searchToken) return;
  if (hits.length) {
    searchCache.set(kw, hits.slice(0, 30));
    setSearchStatus(box, '✅ 搜索完成：点击行定位，「＋标记」加为小区');
  } else {
    setSearchStatus(box, localN ? '✅ 未找到在线结果，仅显示本地结果'
      : '未找到相关地点。可放大地图到目标区域后加载，或使用「➕ 手动标记小区」');
  }
}

/* 输入时本地实时过滤（0 延迟），回车/按钮才触发联网搜索 */
function liveLocalSearch() {
  const kw = $('searchInput').value.trim();
  const box = $('searchResults');
  if (!kw) { box.className = 'search-results hidden'; return; }
  box.className = 'search-results';
  box.innerHTML = '';
  const n = renderLocalHits(box, kw);
  setSearchStatus(box, n ? '↑ 本地匹配，回车联网搜索' : '本地无匹配，回车联网搜索');
}

/* ---- 导出 / 导入 ---- */
function exportData() {
  const blob = new Blob([JSON.stringify(Store.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '常州购房地图数据.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('数据已导出');
}
function importData(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      /* 兼容 BOM 头 */
      const d = JSON.parse(String(fr.result).replace(/^\uFEFF/, ''));
      /* 兼容三种格式：
         ① 标准导出 { communities: {id: {...}}, centerOverrides: {...} }
         ② { communities: [ {...}, ... ] }（数组形式）
         ③ 直接就是小区数组 [ {...}, ... ] */
      const raw = (d && d.communities) ? d.communities : (Array.isArray(d) ? d : null);
      if (!raw) throw new Error('bad');
      const list = Array.isArray(raw) ? raw : Object.values(raw);
      const communities = {};
      let ok = 0, bad = 0;
      list.forEach((c, i) => {
        const lat = parseFloat(c && c.lat), lng = parseFloat(c && c.lng);
        if (!c || !isFinite(lat) || !isFinite(lng)) { bad++; return; }
        const id = String(c.id || ('import-' + Date.now() + '-' + i));
        communities[id] = Object.assign({}, c, { id: id, lat: lat, lng: lng, name: c.name || '未命名小区' });
        ok++;
      });
      if (!ok) throw new Error('no-valid');
      if (!confirm('导入将替换当前已保存的小区与圆心数据（有效 ' + ok + ' 条' +
          (bad ? '，跳过无效 ' + bad + ' 条' : '') + '），继续？')) return;
      Store.data = {
        communities: communities,
        centerOverrides: (d && d.centerOverrides) || {},
        radiusOverrides: (d && d.radiusOverrides) || {}
      };
      Store.save();
      /* 立即回读校验，防止隐私模式/禁用存储导致静默丢失 */
      const savedN = Store.verify();
      if (savedN < ok) {
        alert('⚠️ 导入未能保存！浏览器拒绝写入本地存储（常见于隐私/无痕模式或禁用了存储）。\n' +
          '请改用普通浏览器窗口打开本页面后重新导入。');
        return;
      }
      alert('✅ 已成功导入 ' + ok + ' 个小区，保存在当前浏览器的本地存储中。\n' +
        '提示：数据只存在于这个浏览器里（换设备/换浏览器不会同步），可随时用「⬇ 导出」备份。');
      location.reload();
    } catch (e) {
      toast(e.message === 'no-valid'
        ? '导入失败：文件中没有找到带有效坐标的小区（每条需含数字 lat/lng）'
        : '导入失败：文件格式不对。支持本应用导出的 JSON（含 communities）或小区数组', 'error');
      console.warn('导入失败详情：', e);
    }
  };
  fr.readAsText(file, 'utf-8');
}

/* ---- 圆圈设置（自定义圆心位置与半径） ---- */
function renderCircleSettings() {
  const box = $('circleSettings');
  box.innerHTML = '';
  CONFIG.centers.forEach(cfgRaw => {
    const ct = App.centers[cfgRaw.key];
    const km = (ct ? ct.cfg.radius : cfgRaw.radius) / 1000;
    const row = document.createElement('div');
    row.className = 'cs-row';
    row.innerHTML =
      '<span class="cs-dot" style="background:' + cfgRaw.color + '"></span>' +
      '<span class="cs-name" title="' + escHtml(cfgRaw.name) + '">' + escHtml(cfgRaw.name) + '</span>' +
      '<input type="number" class="cs-radius" min="0.5" max="200" step="0.5" value="' + km + '"> km' +
      '<button type="button" class="cs-reset" title="恢复默认圆心与默认半径">恢复默认</button>';
    row.querySelector('.cs-radius').onchange = e => {
      const v = parseFloat(e.target.value);
      if (!isFinite(v) || v <= 0) { toast('请输入有效半径（公里）', 'error'); e.target.value = km; return; }
      App.setRadius(cfgRaw.key, Math.round(v * 10) / 10);
    };
    row.querySelector('.cs-reset').onclick = () => {
      if (!confirm('将「' + cfgRaw.name + '」恢复为默认圆心与默认半径（' +
        cfgRaw.radius / 1000 + ' km），页面将刷新，继续？')) return;
      delete Store.data.centerOverrides[cfgRaw.key];
      delete Store.data.radiusOverrides[cfgRaw.key];
      Store.save();
      location.reload();
    };
    box.appendChild(row);
  });
  const tip = document.createElement('div');
  tip.className = 'cs-tip';
  tip.textContent = '💡 在地图上拖动圆心图钉即可自定义圆心位置；半径修改即时生效并自动保存。';
  box.appendChild(tip);
}

function toggleCircleSettings() {
  const box = $('circleSettings');
  const willOpen = box.classList.contains('hidden');
  if (willOpen) renderCircleSettings();
  box.className = 'circle-settings' + (willOpen ? '' : ' hidden');
}

