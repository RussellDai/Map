/* ===== region.js: 手绘购房区域 =====
   沿马路/河流/圆圈边点击布点围成多边形区域：
   - 圆圈边：本地计算，零延迟吸附；
   - 马路/河流：Overpass 实时加载 OSM 道路与水系几何（WGS84→GCJ02 纠偏对齐高德底图），逐点吸附中心线；
   - 两点之间即直线，不吸附时自由布点。
   区域可命名/换色/顶点微调/删除，数据存 Store（本地+云同步+导入导出）。 */
const Region = {
  drawing: false,          /* 正在布点画新区域 */
  pts: [],                 /* 当前草图顶点 [L.LatLng] */
  snapOn: true,            /* 吸附开关 */
  editing: null,           /* 正在顶点微调的区域 id */
  layers: new Map(),       /* id -> {rec, poly} */
  preview: null,           /* 草图图层 {line, fill, dots, ghost} */
  editLayers: [],
  _snapHint: null,         /* 鼠标当前位置的吸附目标（用于状态提示） */
  _lastMove: 0
};
Region.PALETTE = ['#e11d48', '#7c3aed', '#0d9488', '#d97706', '#2563eb', '#16a34a', '#db2777'];

/* ---------- 初始化：按钮 / 快捷键 / 地图事件 ---------- */
Region.init = function () {
  $('regionBtn').onclick = () => Region.setMode(!Region.drawing);
  $('rgDone').onclick = () => (Region.editing ? Region.endEdit() : Region.finish());
  $('rgUndo').onclick = () => Region.undo();
  $('rgCancel').onclick = () => (Region.editing ? Region.endEdit() : Region.cancel());
  $('rgSnap').onclick = () => {
    Region.snapOn = !Region.snapOn;
    $('rgSnap').textContent = '🧲 吸附：' + (Region.snapOn ? '开' : '关');
    toast(Region.snapOn ? '已开启吸附（马路/河流/圆圈边）' : '已关闭吸附，自由布点');
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (Region.drawing) Region.cancel();
      else if (Region.editing) Region.endEdit();
    }
  });
  App.map.on('mousemove', Region._onMove);
  /* 右键：绘制中=撤销上一点（同时屏蔽浏览器右键菜单） */
  App.map.on('contextmenu', e => {
    if (Region.drawing) { if (e.originalEvent) e.originalEvent.preventDefault(); Region.undo(); }
  });
  App.map.on('moveend', () => { if (Region.drawing) Region._loadSnap(); });
};

/* ---------- 模式开关（与手动标记/路线导航互斥） ---------- */
Region.setMode = function (on) {
  if (on && Region.editing) Region.endEdit();
  Region.drawing = on;
  if (!on) { Region.pts = []; Region._snapHint = null; Region._clearPreview(); }
  $('regionBtn').classList.toggle('active', on);
  $('regionBtn').textContent = on ? '🎨 划区域：布点中…' : '🎨 划区域';
  $('map').classList.toggle('region-mode', on);
  $('regionPanel').className = 'region-panel' + (on ? '' : ' hidden');
  Region._renderPanel();
  if (on) {
    App.setAddMode(false);
    Route.setMode(false);
    Region._status();
    Region._loadSnap();
  }
};

Region._renderPanel = function () {
  const editing = !!Region.editing;
  $('rgDone').textContent = editing ? '✔ 完成调整' : '✔ 完成';
  $('rgCancel').textContent = editing ? '✖ 退出调整' : '✖ 取消';
  $('rgUndo').classList.toggle('hidden', editing);
  $('rgSnap').classList.toggle('hidden', editing);
};

Region._status = function () {
  const el = $('regionStatus'); if (!el) return;
  if (Region.editing) {
    const entry = Region.layers.get(Region.editing);
    el.innerHTML = '正在调整「' + escHtml(entry ? entry.rec.name : '') + '」：<b>拖动顶点</b>（自动吸附）、' +
      '点击边上的小圆点加点、<b>右键顶点</b>删点。完成后按「✔ 完成调整」';
    return;
  }
  let s = '已布 <b>' + Region.pts.length + '</b> 个点（至少 3 点）' +
    (Region.pts.length >= 3 ? '；点击<b>绿色起点</b>或按「✔ 完成」闭合' : '');
  if (Region._snapHint) {
    const t = Region._snapHint.name || (Region._snapHint.kind === 'water' ? '水系' : '道路');
    s += '<br>🧲 将吸附到：' + escHtml(t);
  } else if (App.map.getZoom() < 13) {
    s += '<br><small>放大到街道级后自动吸附马路/河流；圆圈边始终可吸附</small>';
  }
  el.innerHTML = s;
};

/* ---------- 吸附：圆圈边（本地）→ 马路/河流（OSM） ---------- */
Region._place = function (latlng) {
  if (!Region.snapOn) return { ll: latlng, snap: null };
  const zoom = App.map.getZoom();
  const mpp = 156543.03392 * Math.cos(latlng.lat * Math.PI / 180) / Math.pow(2, zoom);
  const tol = Math.max(18, 10 * mpp);   /* 约 10 像素容差，最少 18 米 */
  /* 1) 圆圈边：把点击位置径向投影到最近的圆圈周长上（圆圈记录字段为 lat/lng/radius） */
  let best = null;
  Object.values(Store.data.circles).forEach(cr => {
    if (!isFinite(+cr.lat) || !isFinite(+cr.lng) || !isFinite(+cr.radius) || +cr.radius <= 0) return;
    const latM = 111320, lngM = 111320 * Math.cos(cr.lat * Math.PI / 180);
    let dx = (latlng.lng - cr.lng) * lngM, dy = (latlng.lat - cr.lat) * latM;
    const d = Math.hypot(dx, dy);
    if (d < 1) return;                  /* 点在圆心上，无方向可投影 */
    const off = Math.abs(d - cr.radius);
    if (off <= tol && (!best || off < best.off)) {
      dx *= cr.radius / d; dy *= cr.radius / d;
      best = {
        off: off,
        ll: L.latLng(cr.lat + dy / latM, cr.lng + dx / lngM),
        snap: { name: cr.name + '（圆圈边）', kind: 'circle' }
      };
    }
  });
  if (best) return best;
  /* 2) 马路/河流：吸附到已加载的 OSM 线段 */
  const s = Overpass.snapToFeature(latlng, tol);
  if (s) return { ll: L.latLng(s.lat, s.lng), snap: s };
  return { ll: latlng, snap: null };
};

/* 吸附数据按当前视野懒加载（静默，失败不弹窗） */
Region._loadSnap = async function () {
  try { await Overpass.loadSnapData(App.map.getBounds(), App.map.getZoom()); }
  catch (e) { /* 无网/被限流时仍可自由布点与圆圈边吸附 */ }
};

/* ---------- 布点 ---------- */
Region.addPoint = function (latlng) {
  const placed = Region._place(latlng);
  const ll = placed.ll;
  /* 靠近起点 → 直接闭合 */
  if (Region.pts.length >= 3) {
    const mpp = 156543.03392 * Math.cos(ll.lat * Math.PI / 180) / Math.pow(2, App.map.getZoom());
    if (distanceKm([ll.lat, ll.lng], [Region.pts[0].lat, Region.pts[0].lng]) * 1000 <= Math.max(15, 12 * mpp)) {
      Region.finish();
      return;
    }
  }
  Region.pts.push(ll);
  Region._drawPreview();
  Region._status();
};

Region.undo = function () {
  if (!Region.pts.length) return;
  Region.pts.pop();
  Region._drawPreview();
  Region._status();
};

Region.cancel = function () { Region.setMode(false); };

/* 鼠标移动：幽灵点 + 橡皮筋预览线 + 吸附提示（节流） */
Region._onMove = function (e) {
  if (!Region.drawing) return;
  const now = Date.now();
  if (now - Region._lastMove < 40) return;
  Region._lastMove = now;
  const placed = Region._place(e.latlng);
  let p = Region.preview;
  if (!p) { Region._drawPreview(); p = Region.preview; }   /* 首个点落下前也显示幽灵点 */
  p.ghost.setLatLng(placed.ll).addTo(App.map);
  p.ghost.setStyle({ color: placed.snap ? '#16a34a' : '#64748b' });
  p.line.setLatLngs(Region.pts.concat([placed.ll]));
  Region._snapHint = placed.snap;
  Region._status();
};

Region._drawPreview = function () {
  if (!Region.preview) {
    Region.preview = {
      line: L.polyline([], { color: '#e11d48', weight: 2, dashArray: '6 6', interactive: false }).addTo(App.map),
      fill: L.polygon([], { color: '#e11d48', weight: 0, fillColor: '#e11d48', fillOpacity: 0.08, interactive: false }).addTo(App.map),
      dots: L.layerGroup().addTo(App.map),
      ghost: L.circleMarker([0, 0], { radius: 6, color: '#64748b', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false })
    };
  }
  const p = Region.preview, pts = Region.pts;
  p.line.setLatLngs(pts);
  p.fill.setLatLngs(pts.length >= 3 ? pts : []);
  p.dots.clearLayers();
  pts.forEach((ll, i) => {
    p.dots.addLayer(L.circleMarker(ll, {
      radius: i === 0 ? 7 : 5, color: '#fff', weight: 2, interactive: false,
      fillColor: i === 0 ? '#16a34a' : '#e11d48', fillOpacity: 1
    }));
  });
};

Region._clearPreview = function () {
  if (!Region.preview) return;
  ['line', 'fill', 'dots', 'ghost'].forEach(k => { try { App.map.removeLayer(Region.preview[k]); } catch (e) { } });
  Region.preview = null;
};



/* ---------- 保存新区域 ---------- */
Region.finish = function () {
  if (Region.pts.length < 3) { toast('至少需要 3 个点才能围成区域', 'error'); return; }
  const def = '区域' + ((Store.data.regions || []).length + 1);
  const name = prompt('给这个区域命名（如：湖塘老城 / 淹城板块）：', def);
  if (name === null) return;   /* 取消命名 → 继续布点 */
  const rec = {
    id: 'rg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim() || def,
    color: Region.PALETTE[(Store.data.regions || []).length % Region.PALETTE.length],
    latlngs: Region.pts.map(p => [p.lat, p.lng]),
    createdAt: Date.now(), updatedAt: Date.now()
  };
  Store.data.regions.push(rec);
  Store.save();
  Region._addLayer(rec);
  Region.setMode(false);
  renderSidebar();
  toast('已保存区域「' + rec.name + '」，点击区域可改名/换色/微调边界', 'success');
};

/* ---------- 图层渲染 ---------- */
Region.buildAll = function () {
  (Store.data.regions || []).forEach(r => Region._addLayer(r));
};

Region._addLayer = function (rec) {
  if (Region.layers.has(rec.id)) return;
  const poly = L.polygon(rec.latlngs, {
    color: rec.color, weight: 2.5, opacity: 0.9, dashArray: '6 4',
    fillColor: rec.color, fillOpacity: 0.1, bubblingMouseEvents: false
  });
  poly.bindTooltip(escHtml(rec.name), { permanent: true, direction: 'center', className: 'region-label' });
  poly.on('click', e => {
    if (Region.drawing) { Region.addPoint(e.latlng); return; }
    if (Region.editing) return;
    Region._openMenu(rec.id, e.latlng);
  });
  App.map.addLayer(poly);
  Region.layers.set(rec.id, { rec: rec, poly: poly });
};

/* 点击区域 → 管理菜单（重命名/换色/调整形状/删除） */
Region._openMenu = function (id, at) {
  const entry = Region.layers.get(id); if (!entry) return;
  const rec = entry.rec;
  const div = document.createElement('div');
  div.className = 'editor';
  div.innerHTML =
    '<div class="editor-title">🎯 区域：' + escHtml(rec.name) + '</div>' +
    '<div class="editor-btns">' +
    '<button class="btn" id="rg-rename">✏️ 重命名</button>' +
    '<button class="btn" id="rg-color">🎨 换颜色</button>' +
    '<button class="btn primary" id="rg-edit">🔧 调整形状</button>' +
    '<button class="btn danger" id="rg-del">🗑 删除</button>' +
    '<button class="btn" id="rg-close">关闭</button>' +
    '</div>';
  const popup = L.popup({ maxWidth: 320, minWidth: 240 }).setLatLng(at).setContent(div);
  App.map.openPopup(popup);
  L.DomEvent.disableClickPropagation(div);
  div.querySelector('#rg-rename').onclick = () => {
    const n = prompt('区域名称：', rec.name);
    if (n === null) return;
    rec.name = n.trim() || rec.name; rec.updatedAt = Date.now(); Store.save();
    entry.poly.setTooltipContent(escHtml(rec.name));
    App.map.closePopup(); renderSidebar();
  };
  div.querySelector('#rg-color').onclick = () => {
    const i = Region.PALETTE.indexOf(rec.color);
    rec.color = Region.PALETTE[(i + 1) % Region.PALETTE.length];
    rec.updatedAt = Date.now(); Store.save();
    entry.poly.setStyle({ color: rec.color, fillColor: rec.color });
    App.map.closePopup(); renderSidebar();
  };
  div.querySelector('#rg-edit').onclick = () => { App.map.closePopup(); Region._startEdit(id); };
  div.querySelector('#rg-del').onclick = () => {
    if (!confirm('确定删除区域「' + rec.name + '」？')) return;
    Region.remove(id);
    App.map.closePopup();
  };
  div.querySelector('#rg-close').onclick = () => App.map.closePopup();
};

Region.remove = function (id) {
  const entry = Region.layers.get(id);
  if (entry) { try { App.map.removeLayer(entry.poly); } catch (e) { } Region.layers.delete(id); }
  Store.data.regions = (Store.data.regions || []).filter(r => r.id !== id);
  Store.save();
  renderSidebar();
  toast('区域已删除');
};


/* ---------- 顶点微调（拖拽吸附 / 中点插入 / 右键删点） ---------- */
Region._startEdit = function (id) {
  const entry = Region.layers.get(id); if (!entry) return;
  Region.editing = id;
  $('regionPanel').className = 'region-panel';
  Region._renderPanel();
  Region._renderEditLayers();
  Region._status();
  Region._loadSnap();
};

Region.endEdit = function () {
  Region.editLayers.forEach(l => { try { App.map.removeLayer(l); } catch (e) { } });
  Region.editLayers = [];
  Region.editing = null;
  $('regionPanel').className = 'region-panel hidden';
  renderSidebar();
};

Region._renderEditLayers = function () {
  Region.editLayers.forEach(l => { try { App.map.removeLayer(l); } catch (e) { } });
  Region.editLayers = [];
  const entry = Region.layers.get(Region.editing); if (!entry) return;
  const rec = entry.rec, n = rec.latlngs.length;
  const commit = () => { rec.updatedAt = Date.now(); entry.poly.setLatLngs(rec.latlngs); Store.save(); };
  const vIcon = L.divIcon({ className: 'rg-vertex-icon', html: '<div class="rg-vertex"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
  const mIcon = L.divIcon({ className: 'rg-mid-icon', html: '<div class="rg-mid"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
  for (let i = 0; i < n; i++) {
    /* 顶点：可拖拽，松手时吸附；右键删除（保留至少 3 点） */
    const m = L.marker(rec.latlngs[i], { icon: vIcon, draggable: true, zIndexOffset: 1200 });
    m.on('dragend', () => {
      const placed = Region._place(m.getLatLng());
      rec.latlngs[i] = [placed.ll.lat, placed.ll.lng];
      m.setLatLng(placed.ll);
      commit(); Region._renderEditLayers();
    });
    m.on('contextmenu', e => {
      if (e.originalEvent) e.originalEvent.preventDefault();
      if (rec.latlngs.length <= 3) { toast('区域至少需要 3 个顶点', 'error'); return; }
      rec.latlngs.splice(i, 1);
      commit(); Region._renderEditLayers();
    });
    App.map.addLayer(m); Region.editLayers.push(m);
    /* 边中点：点击插入新顶点 */
    const a = rec.latlngs[i], b = rec.latlngs[(i + 1) % n];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const mi = L.marker(mid, { icon: mIcon, zIndexOffset: 1100 });
    mi.on('click', e => {
      L.DomEvent.stop(e.originalEvent || e);
      rec.latlngs.splice(i + 1, 0, mid.slice());
      commit(); Region._renderEditLayers();
    });
    App.map.addLayer(mi); Region.editLayers.push(mi);
  }
};

/* ---------- 点与区域关系（供悬停提示/侧栏徽章） ---------- */
Region.pointInRegions = function (lat, lng) {
  const out = [];
  (Store.data.regions || []).forEach(r => {
    if (Region._pip(lat, lng, r.latlngs)) out.push(r);
  });
  return out;
};
/* 射线法：点 [lat,lng] 是否在环 [[lat,lng],...] 内 */
Region._pip = function (lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1], yi = ring[i][0], xj = ring[j][1], yj = ring[j][0];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
