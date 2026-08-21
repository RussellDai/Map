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
/* 分级统一用「表情符号 + 描边」区分，不使用背景色填充 */
const LV_ICON = { focus: '🔴', backup: '🔵', exclude: '⚫' };
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

/* ---- 更多实景：Google Earth Web 三维 / 航拍视频搜索 ---- */
/* Google Earth Web：谷歌级清晰三维实景（含 3D 建筑与地形），坐标需 WGS84 */
function openGoogleEarth(c) {
  if (!c || !isFinite(+c.lat) || !isFinite(+c.lng)) { toast('该小区缺少有效坐标', 'error'); return; }
  const w = GC.gcj02ToWgs84(c.lng, c.lat);
  window.open('https://earth.google.com/web/@' + w[1].toFixed(6) + ',' + w[0].toFixed(6) +
    ',200a,800d,35y,0h,45t,0r', '_blank');
}
/* B站搜索小区航拍/实景视频（国内可访问，视频比瓦片 3D 更直观清晰） */
function openAerialVideo(c) {
  if (!c || !c.name) { toast('缺少小区名称', 'error'); return; }
  window.open('https://search.bilibili.com/all?keyword=' +
    encodeURIComponent(c.name + ' 航拍 实景'), '_blank');
}

/* ---- 看房平台联动：房天下 / 安居客（小区相册、均价走势、户型图） ---- */
/* 清洗小区名关键词：楼盘名常含 ·、()、空格等符号，去掉可提高平台搜索命中率 */
function cleanCommunityKw(name) {
  return String(name || '').replace(/[·・•\-—–_|()（）【】\[\]「」、,，.。!！?？\s]+/g, '').trim();
}
/* 房天下常州站·找小区：cz 子域服务端锁定常州，不会按 IP 跳到别的城市。
   注：贝壳常州站已迁至 cz.fang.ke.com，小区/二手房频道不再开放外链（跳首页或登录墙），
   链家常州站不存在，故用房天下承载小区查询；页面顶部搜索框支持小区名联想 */
function openFang(c) {
  const kw = cleanCommunityKw(c && c.name);
  if (!kw) { toast('缺少小区名称', 'error'); return; }
  window.open('https://cz.esf.fang.com/housing/?keyword=' + encodeURIComponent(kw), '_blank');
  toast('已打开房天下常州站；若未自动筛选，请在页面顶部搜索框输入小区名', 'success');
}
/* 安居客（常州站）小区搜索：楼盘相册、均价走势、小区点评 */
function openAnjuke(c) {
  const kw = cleanCommunityKw(c && c.name);
  if (!kw) { toast('缺少小区名称', 'error'); return; }
  window.open('https://changzhou.anjuke.com/community/search/?keyword=' +
    encodeURIComponent(kw), '_blank');
}

/* ---- 悬停提示内容 ---- */
function tooltipHTML(c) {
  let h = '<div class="tip-name">' + escHtml(c.name) + '</div>';
  const lv = levelOf(c);
  if (lv) h += '<div class="tip-row"><span class="lv-badge lv-' + lv.key + '">' + (LV_ICON[lv.key] || '') + ' ' + lv.name + '</span></div>';
  /* 到每个圆心（不限个数）的估算车程：直线距离 × 绕行系数 ÷ 平均车速 */
  Object.values(App.centers).forEach(ct => {
    const d = distanceKm([c.lat, c.lng], ct.latlng);
    h += '<div class="tip-row">🚗 ' + escHtml(ct.cfg.name) + '：约' + driveMinutes(d) +
      '分钟（直线 ' + d.toFixed(1) + ' km）</div>';
  });
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
    '  <button class="btn" id="f-g3d" title="Google Earth Web 三维实景（更清晰，需可访问 Google 的网络）">🌏 Google 3D</button>' +
    '  <button class="btn" id="f-video" title="在 B站 搜索该小区航拍/实景视频">🎬 航拍视频</button>' +
    '  <button class="btn" id="f-photos" title="在百度图片搜索该小区实景照片">📷 实景照片</button>' +
    '  <button class="btn" id="f-fang" title="在房天下常州站找小区：小区相册、均价走势、户型（已锁定常州，顶部搜索框可输小区名）">🏠 房天下</button>' +
    '  <button class="btn" id="f-anjuke" title="在安居客常州站搜索该小区：楼盘相册、均价走势、小区点评（已锁定常州，如遇滑块验证通过后即达）">🏘 安居客</button>' +
    '  <button class="btn danger" id="f-del">🗑 删除</button>' +
    '  <button class="btn" id="f-cancel">关闭</button>' +
    '</div>';
  /* 手机端适当缩小编辑弹窗，避免超出屏幕 */
  const small = window.matchMedia('(max-width: 768px)').matches;
  const popup = L.popup({ maxWidth: small ? 300 : 360, minWidth: small ? 220 : 300, className: 'editor-popup' })
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
  $('f-g3d').onclick = () => openGoogleEarth(App.records.get(id));
  $('f-video').onclick = () => openAerialVideo(App.records.get(id));
  $('f-photos').onclick = () => {
    const c = App.records.get(id) || {};
    window.open('https://image.baidu.com/search/index?tn=baiduimage&word=' +
      encodeURIComponent((c.name || '小区') + ' 小区 实景'), '_blank');
  };
  $('f-fang').onclick = () => openFang(App.records.get(id));
  $('f-anjuke').onclick = () => openAnjuke(App.records.get(id));

  /* 距离徽章（放在按钮绑定之后，异常不影响保存）：
     先显示直线距离 + 估算车程（即时），再异步用 OSRM 实际驾车车程替换 */
  const distBadgeHtml = (ct, d, inR, minutes, est) =>
    (inR ? '✓' : '✗') + ' 距' + escHtml(ct.cfg.name) + ' ' + d.toFixed(1) + 'km · 🚗约' +
    minutes + '分' + (est ? '' : '（导航）') + (inR ? '（圈内）' : '');
  $('f-dist').innerHTML = Object.values(App.centers).map(ct => {
    const d = distanceKm([c.lat, c.lng], ct.latlng);
    const inR = d <= ct.cfg.radius / 1000;
    return '<span class="dist-badge" id="f-dist-' + ct.cfg.key + '" style="border-color:' + ct.cfg.color + ';color:' + ct.cfg.color + '">' +
      distBadgeHtml(ct, d, inR, driveMinutes(d), true) + '</span>';
  }).join('');
  Object.values(App.centers).forEach(ct => {
    Drive.minutes(c, ct.latlng).then(r => {
      const el = $('f-dist-' + ct.cfg.key);
      if (!el) return;   /* 弹窗已关闭，忽略结果 */
      const d = distanceKm([c.lat, c.lng], ct.latlng);
      const inR = d <= ct.cfg.radius / 1000;
      el.innerHTML = distBadgeHtml(ct, d, inR, r.minutes, false);
    }).catch(e => console.warn('导航车程查询失败，保留估算值：', e.message));
  });
}
/* ---- 侧栏清单 ---- */
function renderSidebar() {
  const list = $('communityList');
  list.innerHTML = '';
  const fAll = $('fltAll') && $('fltAll').checked;
  const checkedKeys = Object.keys(App.centers).filter(k => {
    const el = $('fltC-' + k);
    return el && el.checked;
  });
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
    if (fAll) return Object.values(App.centers).every(ct => x.d[ct.cfg.key] <= ct.cfg.radius / 1000);
    if (checkedKeys.length) return checkedKeys.some(k => x.d[k] <= App.centers[k].cfg.radius / 1000);
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
    card.dataset.id = c.id;   /* 供搜索联动定位高亮（focusSidebarCard） */
    let badges = Object.values(App.centers).map(ct => {
      const dd = d[ct.cfg.key], inR = dd <= ct.cfg.radius / 1000;
      return '<span class="badge ' + (inR ? 'in' : 'out') + '">' +
        escHtml(ct.cfg.name) + ' ' + dd.toFixed(1) + 'km · 🚗约' + driveMinutes(dd) + '分</span>';
    }).join('');
    const lvDots = CONFIG.levels.map(l =>
      '<button class="lv-dot lv-dot-' + l.key + (c.level === l.key ? ' active' : '') +
      '" data-act="lv" data-lv="' + l.key + '" title="设为「' + l.name + '」（再点一次取消）">' + (LV_ICON[l.key] || '') + '</button>').join('');
    card.innerHTML =
      '<div class="card-head"><span class="card-name">' +
      (lv ? '<span class="lv-badge lv-' + lv.key + '">' + (LV_ICON[lv.key] || '') + ' ' + lv.name + '</span>' : '') +
      escHtml(c.name) + '</span>' +
      '<span class="card-price">' + (c.price ? escHtml(c.price) + '元/㎡' : '') + '</span></div>' +
      '<div class="card-badges">' + badges + '</div>' +
      (c.pros ? '<div class="card-line good">👍 ' + escHtml(truncate(c.pros, 30)) + '</div>' : '') +
      (c.cons ? '<div class="card-line bad">👎 ' + escHtml(truncate(c.cons, 30)) + '</div>' : '') +
      '<div class="card-levels">' + lvDots +
      '<button class="lv-street" data-act="street" title="查看该位置街景（Mapillary）">🌐 街景</button>' +
      '<button class="lv-street" data-act="3d" title="查看该位置高德 3D 实景">🏙 3D</button>' +
      '<button class="lv-street" data-act="video" title="搜索该小区航拍/实景视频（B站）">🎬 航拍</button></div>' +
      '<div class="card-btns">' +
      '<button data-act="go">📍 定位</button>' +
      '<button data-act="edit">✏️ 编辑</button>' +
      '<button data-act="del">🗑 删除</button></div>';
    card.querySelectorAll('[data-act="lv"]').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        App.setLevel(c.id, c.level === btn.dataset.lv ? '' : btn.dataset.lv);
      };
    });
    card.querySelector('[data-act="street"]').onclick = e => {
      e.stopPropagation(); openStreetView(App.records.get(c.id));
    };
    card.querySelector('[data-act="3d"]').onclick = e => {
      e.stopPropagation(); Amap3d.open(App.records.get(c.id) || c);
    };
    card.querySelector('[data-act="video"]').onclick = e => {
      e.stopPropagation(); openAerialVideo(App.records.get(c.id) || c);
    };
    card.querySelector('[data-act="go"]').onclick = e => {
      e.stopPropagation(); App.map.flyTo([c.lat, c.lng], 15);
    };
    card.querySelector('[data-act="edit"]').onclick = e => {
      e.stopPropagation(); App.map.flyTo([c.lat, c.lng], 15);
      setTimeout(() => openEditor(c.id), 500);
    };
    card.querySelector('[data-act="del"]').onclick = e => {
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
const SEARCH_CACHE_KEY = 'cz-search-cache-v1';

/* 搜索缓存持久化（localStorage）：搜过的词刷新页面后仍秒出，免疫在线服务限流 */
(function loadSearchCache() {
  try {
    const o = JSON.parse(localStorage.getItem(SEARCH_CACHE_KEY) || '{}');
    Object.keys(o || {}).forEach(k => { if (Array.isArray(o[k])) searchCache.set(k, o[k]); });
  } catch (e) { /* 存储不可用时忽略 */ }
})();
function saveSearchCache() {
  try {
    const o = {};
    Array.from(searchCache.entries()).slice(-80).forEach(e => { o[e[0]] = e[1]; });  // 只留最近 80 个词
    localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(o));
  } catch (e) { }
}

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

/* 结果行重排：已标记(local=2) > 已加载(local=1) > 在线结果(0)；同级常州优先（稳定排序） */
function sortSearchRows(box) {
  const st = box.querySelector('.sr-status');
  const items = Array.prototype.slice.call(box.querySelectorAll('.sr-item:not(.sr-status)'));
  items.sort((a, b) =>
    ((+b.dataset.local || 0) - (+a.dataset.local || 0)) ||
    ((+b.dataset.cz || 0) - (+a.dataset.cz || 0)));
  items.forEach(it => box.insertBefore(it, st));
}

/* 搜索本地小区：① 已保存（已标记）小区全量搜、置顶；② 地图上已加载但未保存的小区限量补充 */
function renderLocalHits(box, kw) {
  let n = 0;
  Store.all().forEach(c => {
    if (!c || !c.name || c.name.indexOf(kw) < 0) return;
    if (!isFinite(+c.lat) || !isFinite(+c.lng)) return;
    const lvIcon = (c.level && LV_ICON[c.level]) ? LV_ICON[c.level] + ' ' : '';
    addSearchRow(box, c.name, lvIcon + '已标记小区' + (hasInfo(c) ? ' · 已填信息' : ''),
      +c.lat, +c.lng, true, '2', c.id);
    n++;
  });
  App.records.forEach(c => {
    if (n >= 16) return;
    if (!c || !c.name || c.name.indexOf(kw) < 0) return;
    if (Store.get(c.id)) return; /* 已保存的上面已展示 */
    addSearchRow(box, c.name, '已加载小区', c.lat, c.lng, true, '1');
    n++;
  });
  return n;
}

/* 搜索联动：滚动到左侧清单对应卡片并高亮闪烁；卡片被筛选隐藏时返回 false */
function focusSidebarCard(id) {
  const sb = $('sidebar');
  if (sb && sb.classList.contains('collapsed')) {      /* 手机端先展开清单 */
    sb.classList.remove('collapsed');
    const t = $('sidebarToggle'); if (t) t.textContent = '▾';
    if (App.map) App.map.invalidateSize();
  }
  const card = document.querySelector('#communityList .card[data-id="' + id + '"]');
  if (!card) return false;
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  card.classList.remove('search-flash');
  void card.offsetWidth;                              /* 强制重排，允许动画重放 */
  card.classList.add('search-flash');
  setTimeout(() => card.classList.remove('search-flash'), 2400);
  return true;
}

/* 添加一条搜索结果。isGcj 表示 lat/lng 是否已是 GCJ02 坐标；
   isLocal：'2'=已标记小区 / '1'=已加载小区 / false=在线结果；recordId 为已标记小区的 id */
function addSearchRow(box, name, sub, lat, lng, isGcj, isLocal, recordId) {
  if (!box._seen) box._seen = new Set();
  const key = name + lat.toFixed(3) + lng.toFixed(3);
  if (box._seen.has(key)) return;
  box._seen.add(key);
  const p = isGcj ? [lng, lat] : GC.wgs84ToGcj02(lng, lat);
  const item = document.createElement('div');
  item.className = 'sr-item';
  item.dataset.local = isLocal === '2' ? '2' : (isLocal ? '1' : '0');
  item.dataset.cz = (inChangzhou(p[1], p[0]) || /常州/.test(String(name || '') + String(sub || ''))) ? '1' : '0';
  item.innerHTML = '<span class="sr-name">' + escHtml(name) +
    (recordId ? '<span class="sr-sub"><i class="sr-saved-tag">⭐ 已标记</i></span>' : '') +
    (sub ? '<span class="sr-sub">' + escHtml(sub) + '</span>' : '') +
    '</span>' + (recordId ? '' : '<button class="sr-add" title="在此处标记为我的小区">＋标记</button>');
  item.onclick = () => {
    App.map.flyTo([p[1], p[0]], 15);
    if (recordId) {
      /* 已标记小区：与左侧清单联动；卡片被筛选隐藏时退回图钉提示 */
      if (!focusSidebarCard(recordId)) App.showSearchPin([p[1], p[0]], name);
    } else {
      App.showSearchPin([p[1], p[0]], name);
    }
    box.className = 'search-results hidden';
  };
  if (!recordId) {
    item.querySelector('.sr-add').onclick = e => {
      e.stopPropagation();
      App.addManualAt(p[1], p[0], name);
      box.className = 'search-results hidden';
    };
  }
  const st = box.querySelector('.sr-status');
  if (st) box.insertBefore(item, st); else box.appendChild(item);
}

function setSearchStatus(box, txt) {
  let s = box.querySelector('.sr-status');
  if (!s) { s = document.createElement('div'); s.className = 'sr-item sr-status'; box.appendChild(s); }
  s.textContent = txt;
}

/* ---- 联网搜索源：均返回 [[name, sub, lat, lng, isGcj], ...]，失败 throw ---- */
/* Photon 地理编码（快，中文较弱） */
function srcPhoton(kw) {
  const czc = czCenter();  // 以常州中心做位置偏好，同名地点优先返回常州（注意：Photon lang 仅支持 default/de/en/fr，勿加 zh）
  return fetchJsonTimeout('https://photon.komoot.io/api/?q=' + encodeURIComponent(kw) +
    '&limit=10&lat=' + czc[0].toFixed(4) + '&lon=' + czc[1].toFixed(4), 8000)
    .then(json => {
      const rows = [];
      ((json && json.features) || []).forEach(f => {
        const pp = (f && f.properties) || {};
        if (!pp.name || !f.geometry || !f.geometry.coordinates) return;
        rows.push([pp.name, [pp.district, pp.city, pp.state].filter(Boolean).join(' '),
          f.geometry.coordinates[1], f.geometry.coordinates[0], false]);
      });
      return rows;
    });
}

/* Nominatim 地理编码（中文较好，限中国，常州 viewbox 偏好；多镜像并行竞速——官方站在国内常超时） */
function srcNominatim(kw) {
  const qs = '/search?format=jsonv2&limit=10&accept-language=zh-CN&countrycodes=cn' +
    '&viewbox=' + czViewBox() + '&bounded=0&q=' + encodeURIComponent(kw);
  const hosts = ['https://nominatim.openstreetmap.org', 'https://nominatim.geocoding.ai'];
  return Promise.any(hosts.map(h => fetchJsonTimeout(h + qs, 8000)))
    .then(json => (json || [])
      .map(r => [r.name || (r.display_name || '').split(',')[0], r.display_name,
        parseFloat(r.lat), parseFloat(r.lon), false])
      .filter(r => r[0] && isFinite(r[2]) && isFinite(r[3])));
}

/* 高德 Geocoder（国内最快、中文地址最强，复用现有 JS API Key；浏览器拦截高德时快速静默失败） */
function srcAmap(kw) {
  const job = Amap3d.load().then(AMap => new Promise((resolve, reject) => {
    try {
      AMap.plugin('AMap.Geocoder', () => {
        try {
          new AMap.Geocoder().getLocation(kw, (st, res) => {
            if (st === 'complete' && res && res.geocodes && res.geocodes.length) {
              resolve(res.geocodes.slice(0, 10).map(g =>
                [kw, g.formattedAddress || '', g.location.getLat(), g.location.getLng(), true]));
            } else reject(new Error('高德无结果'));
          });
        } catch (e) { reject(e); }
      });
    } catch (e) { reject(e); }
  }));
  /* 加载/查询总超时，避免被拦截时无限等待 */
  return Promise.race([job, new Promise((_, rej) =>
    setTimeout(() => rej(new Error('高德超时')), 12000))]);
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
    searchCache.get(kw).forEach(r => addSearchRow(box, r[0], r[1], r[2], r[3], !!r[4]));
    sortSearchRows(box);
    setSearchStatus(box, '✅（缓存结果）点击行定位，「＋标记」加为小区');
    return;
  }
  if (!navigator.onLine) { setSearchStatus(box, '⚠️ 无网络，仅显示本地结果'); return; }

  const hits = [];    // 行格式 [name, sub, lat, lng, isGcj]
  const failed = [];  // 不可用的在线源名称，用于状态栏诊断
  const collect = r => { hits.push(r); addSearchRow(box, r[0], r[1], r[2], r[3], r[4]); };

  /* ① 三源并行竞速：Photon / Nominatim(多镜像) / 高德 Geocoder，谁先出结果谁先渲染，互为备份 */
  setSearchStatus(box, localN ? '↑ 本地匹配；正在联网搜索（多源并行）…'
    : '🔍 正在联网搜索（Photon / Nominatim / 高德 并行）…');
  await Promise.allSettled([
    srcPhoton(kw).then(rows => { rows.forEach(collect); sortSearchRows(box); },
      e => { failed.push('Photon'); console.warn('Photon 不可用:', e.message); }),
    srcNominatim(kw).then(rows => { rows.forEach(collect); sortSearchRows(box); },
      e => { failed.push('Nominatim'); console.warn('Nominatim 不可用:', e.message); }),
    srcAmap(kw).then(rows => { rows.forEach(collect); sortSearchRows(box); },
      e => { failed.push('高德'); console.warn('高德地理编码不可用:', e.message); })
  ]);
  if (my !== searchToken) return;

  /* ② Overpass 深搜兜底（多镜像并行竞速取最快） */
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
        collect([tags.name, '', lat, lng, false]);
      });
      sortSearchRows(box);
    } catch (e) { failed.push('Overpass'); console.warn('Overpass 搜索失败:', e.message); }
  }

  if (my !== searchToken) return;
  if (hits.length) {
    searchCache.set(kw, hits.slice(0, 30));
    saveSearchCache();
    setSearchStatus(box, '✅ 搜索完成：点击行定位，「＋标记」加为小区');
  } else {
    setSearchStatus(box, (localN ? '✅ 未找到在线结果，仅显示本地结果'
      : '未找到相关地点。可放大地图到目标区域后加载，或使用「➕ 手动标记小区」') +
      (failed.length ? '（不可用：' + failed.join('/') + '，可能被限流或广告拦截）' : ''));
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
        /* 新版导出含 circles 数组则原样恢复；旧文件缺失时置 null，由 Store.load() 迁移生成 */
        circles: (d && Array.isArray(d.circles)) ? d.circles : null,
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

/* ---- 动态圆圈筛选复选框 + 图例（圆圈增删改后调用） ---- */
function renderCircleFilters() {
  const wrap = $('circleFilters');
  if (!wrap) return;
  /* 保留用户已勾选状态，避免改半径等操作重置筛选 */
  const prev = {};
  wrap.querySelectorAll('input[type=checkbox]').forEach(i => { prev[i.id] = i.checked; });
  wrap.innerHTML = '';
  const keys = Object.keys(App.centers);
  const mkLabel = (id, text) => {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = !!prev[id];
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(' ' + text));
    wrap.appendChild(lab);
    return cb;
  };
  if (keys.length >= 2) {
    const all = mkLabel('fltAll', '所有圈交集');
    all.onchange = () => {
      if (all.checked) keys.forEach(k => { const el = $('fltC-' + k); if (el) el.checked = false; });
      renderSidebar();
    };
  }
  keys.forEach(k => {
    const ct = App.centers[k];
    const cb = mkLabel('fltC-' + k, ct.cfg.name + ' ' + (ct.cfg.radius / 1000) + 'km内');
    cb.onchange = () => {
      if (cb.checked && $('fltAll')) $('fltAll').checked = false;
      renderSidebar();
    };
  });
  renderLegend();
}

function renderLegend() {
  const el = $('legendCircles');
  if (!el) return;
  el.innerHTML = Object.values(App.centers).map(ct =>
    '<span><span class="dot" style="background:' + ct.cfg.color + '"></span>' + escHtml(ct.cfg.name) + '</span>'
  ).join('');
}

/* ---- 圆圈设置（完整管理：添加/删除圆圈、改名、改半径；圆心在地图上拖拽） ---- */
function renderCircleSettings() {
  const box = $('circleSettings');
  box.innerHTML = '';
  Store.data.circles.forEach(rec => {
    const row = document.createElement('div');
    row.className = 'cs-row';
    const dot = document.createElement('span');
    dot.className = 'cs-dot';
    dot.style.background = rec.color;
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'cs-name-input';
    nameInput.maxLength = 12;
    nameInput.value = rec.name;
    nameInput.title = '圆圈名称（回车或失焦生效）';
    nameInput.dataset.role = 'name'; nameInput.dataset.key = rec.key;
    const rInput = document.createElement('input');
    rInput.type = 'number';
    rInput.className = 'cs-radius';
    rInput.min = '0.5'; rInput.max = '200'; rInput.step = '0.5';
    rInput.value = rec.radius / 1000;
    rInput.title = '半径（公里）';
    rInput.dataset.role = 'radius'; rInput.dataset.key = rec.key;
    const km = document.createElement('span');
    km.className = 'cs-km';
    km.textContent = 'km';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cs-del';
    del.textContent = '✖';
    del.title = '删除该圆圈';
    del.dataset.role = 'del'; del.dataset.key = rec.key;
    row.appendChild(dot);
    row.appendChild(nameInput);
    row.appendChild(rInput);
    row.appendChild(km);
    row.appendChild(del);
    box.appendChild(row);
  });
  /* 事件统一由 bindCircleSettingsEvents() 委托到容器：面板内容重建后按钮依然可点 */
  const actions = document.createElement('div');
  actions.className = 'cs-actions';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn small primary';
  addBtn.textContent = '＋ 添加圆圈';
  addBtn.dataset.role = 'add';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn small';
  resetBtn.textContent = '恢复默认两圈';
  resetBtn.dataset.role = 'reset';
  actions.appendChild(addBtn);
  actions.appendChild(resetBtn);
  box.appendChild(actions);
  const tip = document.createElement('div');
  tip.className = 'cs-tip';
  tip.textContent = '💡 在地图上拖动圆心图钉即可自定义圆心位置；新圆圈默认出现在当前视野中心；名称/半径修改即时生效并自动保存。';
  box.appendChild(tip);
}

function toggleCircleSettings() {
  const box = $('circleSettings');
  const willOpen = box.classList.contains('hidden');
  if (willOpen) {
    /* 手机端清单若处于收起状态，先展开侧栏，否则设置面板会被 CSS 隐藏，看起来像"点了没反应" */
    const sb = $('sidebar');
    if (sb && sb.classList.contains('collapsed')) {
      sb.classList.remove('collapsed');
      const t = $('sidebarToggle'); if (t) t.textContent = '▾';
      if (App.map) App.map.invalidateSize();
    }
    renderCircleSettings();
  }
  box.className = 'circle-settings' + (willOpen ? '' : ' hidden');
}

/* 圆圈设置面板事件委托：只在容器（#circleSettings 常驻 DOM）上绑一次，
   面板内容无论重建多少次，添加/删除/改名/改半径都始终可点，不会因 DOM 重建丢失响应 */
function bindCircleSettingsEvents() {
  const box = $('circleSettings');
  if (!box || box._bound) return;
  box._bound = true;
  function roleOf(el) {                      /* 不依赖 Element.closest 的向上查找 */
    while (el && el !== box) { if (el.dataset && el.dataset.role) return el; el = el.parentElement; }
    return null;
  }
  box.addEventListener('click', e => {
    const t = roleOf(e.target); if (!t) return;
    const role = t.dataset.role;
    if (role === 'add') App.addCircle();
    else if (role === 'reset') App.resetCircles();
    else if (role === 'del' && t.dataset.key) App.removeCircle(t.dataset.key);
  });
  box.addEventListener('change', e => {
    const t = roleOf(e.target); if (!t || !t.dataset.key) return;
    const rec = Store.data.circles.find(c => c.key === t.dataset.key);
    if (!rec) return;
    if (t.dataset.role === 'name') {
      const v = t.value.trim();
      if (v && v !== rec.name) App.renameCircle(rec.key, v); else t.value = rec.name;
    } else if (t.dataset.role === 'radius') {
      const v = parseFloat(t.value);
      if (!isFinite(v) || v <= 0) { toast('请输入有效半径（公里）', 'error'); t.value = rec.radius / 1000; return; }
      App.setRadius(rec.key, Math.round(v * 10) / 10);
    }
  });
}

