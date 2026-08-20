/* ===== route.js: 两点路线导航（点击地图选起终点，OSRM 驾车路线，WGS84→GCJ02 纠偏对齐高德底图） ===== */
const Route = {
  mode: false,
  from: null,   /* {lat,lng} GCJ02 */
  to: null,
  layers: []    /* 已上图层（起终点标记 + 路线） */
};

function routeStatus(html) { $('routeStatus').innerHTML = html; }

/* 进入/退出路线模式 */
Route.setMode = function (on) {
  Route.mode = on;
  if (on) App.setAddMode(false);
  else Route.clear();
  $('routeBtn').classList.toggle('active', on);
  $('routeBtn').textContent = on ? '🧭 导航中：点击地图选点' : '🧭 路线导航';
  $('routePanel').className = 'route-panel' + (on ? '' : ' hidden');
  if (on) routeStatus('第 1 步：点击地图选择<b>起点</b>（也可以直接点击已有的小区点）');
};

/* 清除起终点与路线 */
Route.clear = function () {
  Route.layers.forEach(l => { try { App.map.removeLayer(l); } catch (e) { } });
  Route.layers = [];
  Route.from = null;
  Route.to = null;
  if (Route.mode) routeStatus('已清除。点击地图重新选择<b>起点</b>');
};

function routeAddMarker(latlng, kind) {
  const icon = L.divIcon({
    className: 'route-pin-wrap',
    html: '<div class="route-pin route-' + kind + '">' + (kind === 'from' ? '起' : '终') + '</div>',
    iconSize: [0, 0]
  });
  const m = L.marker(latlng, { icon: icon, draggable: true, zIndexOffset: 900 })
    .addTo(App.map)
    .bindTooltip(kind === 'from' ? '起点（可拖动微调）' : '终点（可拖动微调）', { direction: 'top', offset: [0, -10] });
  m.on('dragend', () => {
    const p = m.getLatLng();
    if (kind === 'from') Route.from = p; else Route.to = p;
    Route.draw();
  });
  Route.layers.push(m);
}

/* 依次分配起终点：无起点→设起点；无终点→设终点并规划路线；都有→重新开始 */
Route.assign = function (latlng) {
  if (!Route.from) {
    Route.from = latlng;
    routeAddMarker(latlng, 'from');
    routeStatus('✅ 已选起点。第 2 步：点击地图选择<b>终点</b>');
  } else if (!Route.to) {
    Route.to = latlng;
    routeAddMarker(latlng, 'to');
    Route.draw();
  } else {
    Route.clear();
    Route.assign(latlng);
  }
};

/* 交换起终点并重新规划（道路路线可能不对称） */
Route.swap = function () {
  if (!Route.from || !Route.to) { toast('请先选择起点和终点', 'error'); return; }
  const t = Route.from; Route.from = Route.to; Route.to = t;
  Route.layers.forEach(l => { try { App.map.removeLayer(l); } catch (e) { } });
  Route.layers = [];
  routeAddMarker(Route.from, 'from');
  routeAddMarker(Route.to, 'to');
  Route.draw();
};

/* 请求 OSRM 驾车路线并绘制（返回 WGS84 → 逐点转 GCJ02 与高德底图对齐） */
Route.draw = function () {
  Route.layers = Route.layers.filter(l => {
    if (l._routeLine) { try { App.map.removeLayer(l); } catch (e) { } return false; }
    return true;
  });
  if (!Route.from || !Route.to) return;
  const straight = distanceKm([Route.from.lat, Route.from.lng], [Route.to.lat, Route.to.lng]);
  routeStatus('🚗 正在规划驾车路线…（直线 ' + straight.toFixed(1) + ' km）');
  const a = GC.gcj02ToWgs84(Route.from.lng, Route.from.lat);
  const b = GC.gcj02ToWgs84(Route.to.lng, Route.to.lat);
  const url = 'https://router.project-osrm.org/route/v1/driving/' +
    a[0].toFixed(6) + ',' + a[1].toFixed(6) + ';' + b[0].toFixed(6) + ',' + b[1].toFixed(6) +
    '?overview=full&geometries=geojson';
  fetchJsonTimeout(url, 12000)
    .then(json => {
      if (!Route.from || !Route.to) return;
      const rt = json && json.routes && json.routes[0];
      if (!rt || !rt.geometry) throw new Error('no route');
      const pts = (rt.geometry.coordinates || []).map(c => {
        const p = GC.wgs84ToGcj02(c[0], c[1]);
        return [p[1], p[0]];
      });
      const line = L.polyline(pts, { color: '#2563eb', weight: 5, opacity: 0.85 });
      line._routeLine = true;
      line.addTo(App.map);
      Route.layers.push(line);
      App.map.fitBounds(line.getBounds().pad(0.15));
      routeStatus('🚗 驾车约 <b>' + (rt.distance / 1000).toFixed(1) + ' km</b> · 约 ' +
        Math.round(rt.duration / 60) + ' 分钟 <span class="route-hint">（直线 ' + straight.toFixed(1) +
        ' km · 起终点可拖动微调）</span>');
    })
    .catch(e => {
      console.warn('OSRM 路线请求失败，改用直线：', e.message);
      if (!Route.from || !Route.to) return;
      const line = L.polyline([[Route.from.lat, Route.from.lng], [Route.to.lat, Route.to.lng]],
        { color: '#64748b', weight: 3, dashArray: '6,6' });
      line._routeLine = true;
      line.addTo(App.map);
      Route.layers.push(line);
      routeStatus('⚠️ 驾车路线请求失败（可能网络受限），显示直线距离 <b>' + straight.toFixed(1) + ' km</b>');
    });
};
