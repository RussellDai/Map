/* ===== app.js: 地图初始化、圆圈、标记管理 ===== */
const App = {
  map: null,
  records: new Map(),      // id -> 小区记录（内存中全部可见小区）
  markerIndex: new Map(),  // id -> leaflet 图层
  centers: {},             // key -> {cfg, latlng, circle, marker}
  addMode: false,
  searchPin: null
};

function centerIcon(cfg) {
  return L.divIcon({
    className: 'center-pin-wrap',
    html: '<div class="center-pin" style="--c:' + cfg.color + '">' +
      '<div class="center-dot">' + (cfg.radius / 1000) + '</div>' +
      '<div class="center-tip"></div>' +
      '<div class="center-label">' + cfg.name + ' · ' + (cfg.radius / 1000) + 'km圈</div></div>',
    iconSize: [0, 0]
  });
}
function houseIcon(level) {
  /* 底色保持绿色不变，分级用右上角小徽标表示 */
  return L.divIcon({ className: 'house-pin-wrap',
    html: '<div class="house-pin">🏠' + (level ? '<i class="pin-lv pin-lv-' + level + '"></i>' : '') + '</div>',
    iconSize: [0, 0] });
}

/* 构建所有生活圈：圆圈 + 可拖拽圆心图钉。
   数据源为 Store.data.circles 数组（用户可任意增删改，cfg 即数组元素本身的引用）。 */
function buildCircles() {
  App.centers = {};
  Store.data.circles.forEach(rec => {
    const ll = L.latLng(rec.lat, rec.lng);
    const circle = L.circle(ll, {
      radius: rec.radius, color: rec.color, weight: 2, opacity: 0.85,
      fillColor: rec.color, fillOpacity: 0.05, bubblingMouseEvents: false
    }).addTo(App.map);
    circle.bindTooltip(rec.name + ' · ' + (rec.radius / 1000) + '公里生活圈', { sticky: true });
    /* 圆圈默认拦截点击（bubblingMouseEvents:false）；路线/添加模式下转发 */
    circle.on('click', e => {
      if (Route.mode) { Route.assign(e.latlng); return; }
      if (App.addMode) App.addManualAt(e.latlng.lat, e.latlng.lng, '新小区');
    });
    const marker = L.marker(ll, { draggable: true, icon: centerIcon(rec), zIndexOffset: 1000 }).addTo(App.map);
    marker.bindTooltip('拖动可微调「' + rec.name + '」圆心位置', { direction: 'top' });
    marker.on('click', e => {
      if (Route.mode) { Route.assign(e.latlng); return; }
      if (App.addMode) App.addManualAt(e.latlng.lat, e.latlng.lng, '新小区');
    });
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      circle.setLatLng(p);
      rec.lat = p.lat; rec.lng = p.lng;
      App.centers[rec.key].latlng = p;
      Store.save();
      renderSidebar();
      toast('「' + rec.name + '」圆心已更新');
    });
    App.centers[rec.key] = { cfg: rec, latlng: ll, circle: circle, marker: marker };
  });
}

function initApp() {
  if (!window.L) {
    $('map').innerHTML = '<div style="padding:40px;font-size:16px">Leaflet 库加载失败，请联网后刷新页面。</div>';
    return;
  }
  if (App.map) return; /* 幂等保护：防止 DOMContentLoaded 多次触发导致重复初始化 */
  Store.load();
  console.log('[存储诊断] 本站点本地已保存小区 ' + Store.all().length + ' 个，站点地址：' + location.origin);
  const map = L.map('map', { preferCanvas: true }).setView([31.71, 119.85], 10);
  App.map = map;
  /* 路线面板浮在地图容器内：阻止点击/滚轮穿透到地图 */
  L.DomEvent.disableClickPropagation($('routePanel'));
  L.DomEvent.disableScrollPropagation($('routePanel'));

  /* 高德底图：街道图 + 卫星图（右下角可切换） */
  const road = L.tileLayer(CONFIG.tileRoad, {
    subdomains: CONFIG.subdomains, maxZoom: 19, maxNativeZoom: 18,
    attribution: '© 高德地图 · 小区数据 © OpenStreetMap'
  });
  const sat = L.layerGroup([
    L.tileLayer(CONFIG.tileSat, { subdomains: CONFIG.subdomains, maxZoom: 19, maxNativeZoom: 18 }),
    L.tileLayer(CONFIG.tileSatLabel, { subdomains: CONFIG.subdomains, maxZoom: 19, maxNativeZoom: 18 })
  ]);
  road.addTo(map);
  L.control.layers({ '街道地图': road, '卫星影像': sat }, null,
    { position: 'bottomright', collapsed: true }).addTo(map);
  L.control.scale({ metric: true, imperial: false }).addTo(map);

  /* 生活圈圆圈 + 可拖拽圆心（数据驱动，支持任意增删改，见 buildCircles） */
  buildCircles();

  /* 视野自适应：同时容纳两个圆 */
  let b = null;
  Object.values(App.centers).forEach(c => {
    const cb = c.circle.getBounds();
    b = b ? b.extend(cb) : L.latLngBounds(cb.getSouthWest(), cb.getNorthEast());
  });
  if (b) map.fitBounds(b.pad(0.06));

  /* 恢复已保存的小区（坐标无效的条目跳过并提示，避免拖垮整个清单渲染） */
  let badRec = 0;
  Store.all().forEach(c => {
    if (!c || !isFinite(+c.lat) || !isFinite(+c.lng)) { badRec++; return; }
    App.records.set(c.id, Object.assign({}, c));
    App.addCommunityMarker(App.records.get(c.id));
  });
  if (badRec) toast('⚠️ 有 ' + badRec + ' 条小区数据坐标无效已跳过，可导出检查后重新导入', 'error');

  /* 点击地图：路线模式优先设置起终点；否则手动添加（仅在添加模式下） */
  map.on('click', e => {
    if (Route.mode) { Route.assign(e.latlng); return; }
    if (App.addMode) App.addManualAt(e.latlng.lat, e.latlng.lng, '新小区');
  });

  /* 视野移动后自动加载小区 */
  map.on('moveend', debounce(() => Overpass.loadInView(), 600));
  setTimeout(() => Overpass.loadInView(), 800);

  /* 顶栏按钮绑定 */
  $('addModeBtn').onclick = () => App.setAddMode(!App.addMode);
  $('routeBtn').onclick = () => Route.setMode(!Route.mode);
  $('routeSwap').onclick = () => Route.swap();
  $('routeClear').onclick = () => Route.clear();
  $('routeExit').onclick = () => Route.setMode(false);
  $('circleSettingsBtn').onclick = toggleCircleSettings;
  $('searchBtn').onclick = doSearch;
  $('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  $('searchInput').addEventListener('input', debounce(liveLocalSearch, 250));
  document.addEventListener('click', e => {
    const box = $('searchResults');
    if (!box.contains(e.target) && e.target !== $('searchInput')) box.className = 'search-results hidden';
  });
  $('exportBtn').onclick = exportData;
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = e => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  };
  renderCircleFilters();
  $('fltLevel').onchange = renderSidebar;
  /* 手机端：收起/展开侧栏清单 */
  $('sidebarToggle').onclick = () => {
    const sb = $('sidebar');
    const collapsed = sb.classList.toggle('collapsed');
    $('sidebarToggle').textContent = collapsed ? '▴' : '▾';
    App.map.invalidateSize();
  };
  renderSidebar();
}

/* 设置圆圈半径（公里）：同步圆圈/图钉标签/tooltip/侧栏距离徽标，并持久化 */
App.setRadius = function (key, km) {
  const ct = App.centers[key];
  if (!ct || !isFinite(km) || km <= 0) return;
  ct.cfg.radius = km * 1000;
  Store.save();
  ct.circle.setRadius(km * 1000);
  ct.marker.setIcon(centerIcon(ct.cfg));
  renderCircleFilters();
  ct.circle.setTooltipContent(ct.cfg.name + ' · ' + km + '公里生活圈');
  renderSidebar();
  toast('「' + ct.cfg.name + '」半径已更新为 ' + km + ' km');
};

/* 增删改圆圈后：重建图层并刷新筛选/图例/清单/设置面板 */
App.rebuildCircles = function () {
  Object.values(App.centers).forEach(ct => { App.map.removeLayer(ct.circle); App.map.removeLayer(ct.marker); });
  buildCircles();
  renderCircleFilters();
  renderSidebar();
  if (!$('circleSettings').classList.contains('hidden')) renderCircleSettings();
};

/* 添加新圆圈：默认半径 5km，圆心落在当前地图视野中心（用户随后可拖动图钉） */
App.addCircle = function () {
  const palette = ['#2563eb', '#ea580c', '#16a34a', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#64748b'];
  const used = Store.data.circles.map(c => c.color);
  const color = palette.filter(c => used.indexOf(c) < 0)[0] || palette[Store.data.circles.length % palette.length];
  const c = App.map.getCenter();
  const rec = { key: 'c' + Date.now(), name: '自定义圈' + (Store.data.circles.length + 1), color: color, radius: 5000, lat: c.lat, lng: c.lng };
  Store.data.circles.push(rec);
  Store.save();
  App.rebuildCircles();
  toast('已添加「' + rec.name + '」（半径 5km），拖动其圆心图钉调整位置');
};

App.removeCircle = function (key) {
  const rec = Store.data.circles.find(c => c.key === key);
  if (!rec) return;
  if (!confirm('删除圆圈「' + rec.name + '」？（不影响已保存的小区数据）')) return;
  Store.data.circles = Store.data.circles.filter(c => c.key !== key);
  Store.save();
  App.rebuildCircles();
  toast('已删除「' + rec.name + '」');
};

App.renameCircle = function (key, name) {
  const ct = App.centers[key];
  if (!ct || !name) return;
  ct.cfg.name = name;
  Store.save();
  ct.marker.setIcon(centerIcon(ct.cfg));
  ct.marker.setTooltipContent('拖动可微调「' + name + '」圆心位置');
  ct.circle.setTooltipContent(name + ' · ' + (ct.cfg.radius / 1000) + '公里生活圈');
  renderCircleFilters();
  renderSidebar();
};

App.resetCircles = function () {
  if (!confirm('恢复为默认的两个生活圈（遥观 / 金坛）？自定义圆圈及所有圆心、半径修改将被清除。')) return;
  Store.data.circles = defaultCircles();
  Store.save();
  App.rebuildCircles();
  toast('已恢复默认圆圈');
};

App.setAddMode = function (on) {
  if (on && Route.mode) Route.setMode(false);
  App.addMode = on;
  $('addModeBtn').classList.toggle('active', on);
  $('addModeBtn').textContent = on ? '🎯 点击地图放置小区（再按一次取消）' : '➕ 手动标记小区';
  if (App.map) App.map.getContainer().classList.toggle('add-mode', on);
};

App.addManualAt = function (lat, lng, name) {
  const id = 'manual-' + Date.now();
  const c = { id: id, name: name || '新小区', lat: lat, lng: lng, source: 'manual' };
  App.records.set(id, c);
  App.addCommunityMarker(c);
  App.setAddMode(false);
  openEditor(id);
};

App.addCommunityMarker = function (c) {
  if (App.markerIndex.has(c.id)) return;
  let layer;
  if (c.source === 'manual') {
    layer = L.marker([c.lat, c.lng], { icon: houseIcon(c.level), bubblingMouseEvents: false });
  } else {
    layer = L.circleMarker([c.lat, c.lng], {
      radius: 5, weight: 1.5, color: '#ffffff',
      fillColor: '#94a3b8', fillOpacity: 0.95, bubblingMouseEvents: false
    });
  }
  layer.bindTooltip(() => tooltipHTML(App.records.get(c.id) || c),
    { sticky: true, direction: 'top', offset: [0, -8] });
  layer.on('click', e => {
    /* 路线模式下点击 = 设为起点/终点 */
    if (Route.mode && e.latlng) { Route.assign(e.latlng); return; }
    /* 添加模式下点击已有点 = 在其位置放新标记（已有点不冒泡到地图，否则会被吞掉） */
    if (App.addMode && e.latlng) { App.addManualAt(e.latlng.lat, e.latlng.lng, '新小区'); return; }
    openEditor(c.id);
  });
  layer.addTo(App.map);
  App.markerIndex.set(c.id, layer);
  App.refreshMarkerStyle(c.id);
};

App.refreshMarkerStyle = function (id) {
  const layer = App.markerIndex.get(id), c = App.records.get(id);
  if (!layer || !c) return;
  const lv = levelOf(c);
  if (c.source === 'manual') {
    if (layer.setIcon) layer.setIcon(houseIcon(c.level));
    return;
  }
  if (!layer.setStyle) return;
  /* 底色只表示「是否填过信息」（灰/绿），分级用外圈样式表达，底色不再整体变色 */
  const st = {
    fillColor: hasInfo(c) ? '#10b981' : '#94a3b8', fillOpacity: 0.95,
    radius: hasInfo(c) ? 7 : 5, color: '#ffffff', weight: 1.5, opacity: 1, dashArray: null
  };
  if (lv) {
    st.radius = 8;
    if (lv.key === 'focus') { st.color = '#dc2626'; st.weight = 3; }        /* 红色实线外圈 */
    else if (lv.key === 'backup') { st.color = '#2563eb'; st.weight = 3; }  /* 蓝色实线外圈 */
    else { st.color = '#64748b'; st.weight = 2; st.dashArray = '3,3'; st.fillOpacity = 0.4; st.opacity = 0.9; } /* 灰色虚线外圈+淡化 */
  }
  layer.setStyle(st);
};

/* 设置小区分级（focus/backup/exclude/''），立即保存并同步地图与清单 */
App.setLevel = function (id, level) {
  const c = App.records.get(id) || Store.get(id);
  if (!c) return;
  c.level = level || '';
  if (!App.records.has(id)) App.records.set(id, c);
  Store.upsert(c);
  App.refreshMarkerStyle(id);
  renderSidebar();
};

App.removeCommunity = function (id) {
  const layer = App.markerIndex.get(id);
  if (layer) App.map.removeLayer(layer);
  App.markerIndex.delete(id);
  App.records.delete(id);
  Store.remove(id);
  renderSidebar();
};

App.showSearchPin = function (latlng, name) {
  if (App.searchPin) App.map.removeLayer(App.searchPin);
  const icon = L.divIcon({ className: 'search-pin-wrap', html: '<div class="search-pin">🔎</div>', iconSize: [0, 0] });
  App.searchPin = L.marker(latlng, { icon: icon }).addTo(App.map)
    .bindPopup('<b>' + escHtml(name) + '</b><br>可在地图上找到该小区后点击填写信息').openPopup();
};

document.addEventListener('DOMContentLoaded', initApp);

