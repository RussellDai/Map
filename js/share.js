/* ===== share.js: 一键导出「分享快照」——自包含单文件 HTML 只读地图 =====
   把当前已保存的小区（含分级/单价/优缺点/备注）、生活圈圆圈、手绘区域
   以及点击分享时的视野打包进一个 HTML 文件：对方用微信收到后，用浏览器打开
   即可看到可平移缩放的交互地图（Leaflet CDN + 高德瓦片，无需 Key、只读）。
   适合临时把看房进展分享给中介/家人。 */

/* ---- 主应用侧：采集快照并下载 HTML ---- */
function shareSnapshot() {
  const comm = Object.values(Store.data.communities || {});
  const circles = Store.data.circles || [];
  const regions = Store.data.regions || [];
  if (!comm.length && !regions.length) {
    toast('还没有可分享的小区或区域', 'error');
    return;
  }
  const nInfo = comm.filter(hasInfo).length;
  if (!confirm('即将生成分享快照：\n' +
      '· ' + comm.length + ' 个小区（' + nInfo + ' 个已填信息，含分级/单价/优缺点/备注）\n' +
      '· ' + circles.length + ' 个生活圈圆圈 · ' + regions.length + ' 个手绘区域\n\n' +
      '生成的 HTML 文件发给对方后，用浏览器打开即可查看（只读，可平移缩放）。\n' +
      '注意：你填写的优缺点和备注对方都能看到。继续？')) return;

  const center = App.map.getCenter();
  const snap = {
    app: '常州购房地图 · 分享快照',
    at: new Date().toLocaleString('zh-CN', { hour12: false }),
    view: { lat: center.lat, lng: center.lng, zoom: App.map.getZoom() },
    levels: CONFIG.levels.map(l => ({ key: l.key, name: l.name, color: l.color })),
    circles: circles.map(cr => ({ name: cr.name, color: cr.color, radius: +cr.radius, lat: +cr.lat, lng: +cr.lng })),
    regions: regions.map(r => ({ name: r.name, color: r.color, latlngs: r.latlngs })),
    communities: comm.map(c => ({
      name: c.name || '未命名小区', lat: +c.lat, lng: +c.lng, level: c.level || '',
      price: c.price || '', totalPrice: c.totalPrice || '',
      pros: c.pros || '', cons: c.cons || '', note: c.note || '',
      filled: hasInfo(c)
    })).filter(c => isFinite(c.lat) && isFinite(c.lng))
  };
  /* 转义 "<" 防止数据里的 </script> 截断内嵌脚本 */
  const json = JSON.stringify(snap).replace(/</g, '\\u003c');
  const html = shareTemplate(json);

  const d = new Date(), p = n => String(n).padStart(2, '0');
  const fname = '常州购房地图-分享-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    '-' + p(d.getHours()) + p(d.getMinutes()) + '.html';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('✅ 快照已下载（' + fname + '），微信/QQ 发给对方，浏览器打开即可看');
}

/* ---- 分享页模板：自包含单文件（Leaflet CDN + 高德瓦片，无需 Key） ---- */
function shareTemplate(json) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>常州购房地图 · 分享快照</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      onerror="this.onerror=null;this.href='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'">
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, 'Microsoft YaHei', sans-serif; }
  #map { position: absolute; top: 0; bottom: 0; left: 0; right: 0; }
  #bar { position: absolute; top: 0; left: 0; right: 0; z-index: 1000; display: flex; align-items: center;
    gap: 10px; flex-wrap: wrap; padding: 6px 10px; font-size: 13px;
    background: rgba(255,255,255,.96); box-shadow: 0 1px 6px rgba(0,0,0,.25); }
  #bar b { font-size: 14px; }
  #bar .meta { color: #64748b; }
  #fitBtn { margin-left: auto; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px;
    padding: 4px 10px; cursor: pointer; font-size: 13px; }
  #fitBtn:hover { background: #f1f5f9; }
  .rg-label { background: none; border: none; white-space: nowrap; font-weight: 700; font-size: 12px;
    color: #0f172a; text-shadow: 0 1px 2px #fff, 0 -1px 2px #fff, 1px 0 2px #fff, -1px 0 2px #fff; }
  .pop .p-name { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
  .pop .p-row { margin: 2px 0; font-size: 12px; line-height: 1.5; }
  .pop .good { color: #047857; } .pop .bad { color: #b91c1c; }
  .lv { display: inline-block; font-size: 10px; border-radius: 8px; padding: 1px 7px; margin-right: 5px;
    vertical-align: 1px; background: #fff; border: 1px solid; font-weight: 700; }
  @media (max-width: 600px) { #bar { font-size: 12px; gap: 6px; } #bar b { font-size: 13px; } }
</style>
</head>
<body>
<div id="map"></div>
<div id="bar">
  <b>🏠 常州购房地图 · 分享快照</b>
  <span class="meta" id="meta"></span>
  <button id="fitBtn" type="button">🗺 看全貌</button>
</div>
<script>window.__SNAP__ = ${json};</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>window.L||document.write('<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"><\\/script>')</script>
<script>
(function () {
  var D = window.__SNAP__;
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  var map = L.map('map', { minZoom: 5, maxZoom: 19 }).setView([D.view.lat, D.view.lng], D.view.zoom);
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}&lang=zh_cn&size=1&scale=1',
    { subdomains: ['1', '2', '3', '4'], maxZoom: 19, maxNativeZoom: 18, attribution: '&copy; 高德地图' }).addTo(map);

  document.getElementById('meta').textContent = D.at + ' · ' + D.communities.length + ' 小区 / ' +
    D.circles.length + ' 圆圈 / ' + D.regions.length + ' 区域（只读）';

  /* 生活圈圆圈 */
  (D.circles || []).forEach(function (cr) {
    if (!isFinite(+cr.lat) || !isFinite(+cr.lng) || !cr.radius) return;
    L.circle([cr.lat, cr.lng], { radius: +cr.radius, color: cr.color || '#2563eb', weight: 1.5, fillOpacity: 0.04 })
      .bindTooltip((cr.name || '圆圈') + ' · ' + (+cr.radius / 1000) + ' 公里生活圈', { sticky: true })
      .addTo(map);
  });

  /* 手绘区域：多边形 + 中心常驻名称 */
  (D.regions || []).forEach(function (r) {
    if (!r.latlngs || r.latlngs.length < 3) return;
    var poly = L.polygon(r.latlngs, { color: r.color || '#e11d48', weight: 2, fillOpacity: 0.12 }).addTo(map);
    poly.bindTooltip('🎯 区域：' + esc(r.name), { sticky: true });
    L.marker(poly.getBounds().getCenter(), {
      icon: L.divIcon({ className: 'rg-label', html: esc(r.name), iconSize: [0, 0] }),
      interactive: false
    }).addTo(map);
  });

  var LV = {};
  (D.levels || []).forEach(function (l) { LV[l.key] = l; });

  function distKm(aLat, aLng, bLat, bLng) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function detailHtml(c) {
    var lv = LV[c.level];
    var h = '<div class="p-name">' +
      (lv ? '<span class="lv" style="border-color:' + lv.color + ';color:' + lv.color + '">' + esc(lv.name) + '</span>' : '') +
      esc(c.name) + '</div>';
    if (c.price) {
      h += '<div class="p-row">💰 单价 <b>' + esc(c.price) + '</b> 元/㎡' +
        (c.totalPrice ? ' · 总价 ' + esc(c.totalPrice) + '万' : '') + '</div>';
    }
    if (c.pros) h += '<div class="p-row good">👍 ' + esc(c.pros) + '</div>';
    if (c.cons) h += '<div class="p-row bad">👎 ' + esc(c.cons) + '</div>';
    if (c.note) h += '<div class="p-row">📌 ' + esc(c.note) + '</div>';
    (D.circles || []).forEach(function (cr) {
      if (!isFinite(+cr.lat) || !isFinite(+cr.lng) || !cr.radius) return;
      var d = distKm(c.lat, c.lng, +cr.lat, +cr.lng);
      h += '<div class="p-row">📍 距「' + esc(cr.name) + '」<b>' + d.toFixed(1) + '</b> 公里' +
        (d <= cr.radius / 1000 ? ' · ✅ 圈内' : '') + '</div>';
    });
    return h;
  }

  /* 小区标记：底色=是否填过信息，外圈=分级（与主应用一致） */
  D.communities.forEach(function (c) {
    var lv = LV[c.level];
    var mk = L.circleMarker([c.lat, c.lng], {
      radius: lv ? 7 : 6,
      weight: lv ? 2.5 : 1.5,
      color: lv ? lv.color : '#94a3b8',
      dashArray: c.level === 'exclude' ? '4 3' : null,
      fillColor: c.filled ? '#10b981' : '#94a3b8',
      fillOpacity: c.level === 'exclude' ? 0.45 : 0.95
    }).addTo(map);
    mk.bindTooltip('<b>' + esc(c.name) + '</b>' + (lv ? ' · ' + esc(lv.name) : '') + (c.filled ? '' : ' · 未填信息'), { direction: 'top' });
    mk.bindPopup('<div class="pop">' + detailHtml(c) + '</div>', { maxWidth: 300 });
  });

  /* 一键看全貌：缩放包住全部小区/区域/圆圈 */
  document.getElementById('fitBtn').onclick = function () {
    var pts = [];
    D.communities.forEach(function (c) { pts.push([c.lat, c.lng]); });
    (D.regions || []).forEach(function (r) { (r.latlngs || []).forEach(function (p) { pts.push(p); }); });
    (D.circles || []).forEach(function (cr) { if (isFinite(+cr.lat) && isFinite(+cr.lng)) pts.push([+cr.lat, +cr.lng]); });
    if (!pts.length) { alert('没有可显示的内容'); return; }
    map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 15 });
  };
})();
</script>
</body>
</html>`;
}