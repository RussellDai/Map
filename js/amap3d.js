/* ===== amap3d.js: 高德 3D 实景（JS API 2.0，首次点击时懒加载） ===== */
const Amap3d = {
  _AMap: null,
  _loading: null,
  _map: null,
  _watch: null,

  /* 加载高德 JS API 2.0（安全密钥必须在脚本加载前设置） */
  load() {
    if (this._AMap) return Promise.resolve(this._AMap);
    if (this._loading) return this._loading;
    window._AMapSecurityConfig = { securityJsCode: CONFIG.amap.securityJsCode };
    this._loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://webapi.amap.com/maps?v=2.0&key=' + CONFIG.amap.key +
        '&plugin=AMap.ToolBar,AMap.ControlBar';
      s.onload = () => {
        if (window.AMap) { this._AMap = window.AMap; resolve(window.AMap); }
        else { this._loading = null; reject(new Error('脚本已加载但未初始化')); }
      };
      s.onerror = () => { this._loading = null; reject(new Error('脚本加载失败，请检查网络')); };
      document.head.appendChild(s);
    });
    return this._loading;
  },

  /* 打开指定小区的 3D 实景弹窗（小区坐标本身即 GCJ02，可直接使用） */
  open(c) {
    if (!c) return;
    this.load().then(AMap => this._show(AMap, c))
      .catch(e => toast('高德 3D 实景不可用：' + e.message, 'error'));
  },

  _setStatus(mask, html) {
    const s = mask.querySelector('#amap3dStatus');
    if (s) s.innerHTML = html;
  },

  _show(AMap, c) {
    this.close();
    const center = [Number(c.lng), Number(c.lat)];
    if (!isFinite(center[0]) || !isFinite(center[1])) {
      toast('该小区缺少有效坐标，无法打开 3D 实景', 'error');
      return;
    }
    const mask = document.createElement('div');
    mask.id = 'amap3dMask';
    mask.innerHTML =
      '<div class="amap3d-box">' +
      '  <div class="amap3d-head">' +
      '    <span class="amap3d-title">🏙 3D实景 · ' + escHtml(c.name) + '</span>' +
      '    <span class="amap3d-hint">左键拖动平移 · 右键拖动旋转 · 滚轮缩放 · 右上罗盘调整俯仰</span>' +
      '    <button type="button" class="amap3d-close" id="amap3dClose">✕ 关闭</button>' +
      '  </div>' +
      '  <div class="amap3d-map" id="amap3dMap">' +
      '    <div class="amap3d-status" id="amap3dStatus">⏳ 正在加载高德 3D 地图…</div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(mask);

    mask.querySelector('#amap3dClose').onclick = () => this.close();
    mask.addEventListener('click', e => { if (e.target === mask) this.close(); });

    /* 卫星影像 + 路网 + 3D 楼块，俯仰 62° 呈现实景感 */
    let map;
    try {
      map = new AMap.Map('amap3dMap', {
        zoom: 17.2,
        center: center,
        viewMode: '3D',
        pitch: 62,
        rotation: 0,
        skyColor: '#3a6ea8',
        buildingAnimation: true,
        features: ['bg', 'road', 'building', 'point'],
        layers: [new AMap.TileLayer.Satellite(), new AMap.TileLayer.RoadNet()]
      });
    } catch (e) {
      console.error('高德地图初始化失败', e);
      this._setStatus(mask, '❌ 地图初始化失败：' + escHtml(String(e && e.message || e)));
      toast('高德 3D 实景初始化失败', 'error');
      return;
    }
    this._map = map;

    /* 小区位置标记 */
    map.add(new AMap.Marker({
      position: center,
      content: '<div class="amap3d-pin">🏠</div>',
      offset: new AMap.Pixel(-15, -38),
      title: c.name
    }));

    try {
      map.addControl(new AMap.ControlBar({ position: { top: 12, right: 12 } }));
      map.addControl(new AMap.ToolBar({ liteStyle: true }));
    } catch (e) { console.warn('高德控件添加失败', e); }

    /* 首帧渲染完成后移除加载提示 */
    map.on('complete', () => {
      clearTimeout(this._watch);
      const s = document.getElementById('amap3dStatus');
      if (s) s.remove();
    });

    /* 10 秒未渲染完成 → 多半是 Key/安全密钥/域名白名单问题，给出排查提示 */
    /* 8 秒未渲染完成 → 多半是 Key/安全密钥/域名绑定问题，给出排查提示 */
    this._watch = setTimeout(() => {
      if (!document.getElementById('amap3dMask')) return;
      const keyTail = '…' + CONFIG.amap.key.slice(-6);
      this._setStatus(mask,
        '⚠️ 高德 3D 地图长时间未渲染。请按 F12 打开控制台，查看以「AMap JSAPI」或' +
        ' INVALID_USER_KEY / INVALID_USER_SCODE / USERKEY_PLAT_NOMATCH 开头的报错，然后对照排查：<br>' +
        '① 控制台（console.amap.com）中 Key「' + escHtml(keyTail) + '」的服务类型必须是「Web端(JS API)」（不能是"Web服务"）<br>' +
        '② 安全密钥须与同一 Key 配对：Key 详情页「安全密钥」按钮查看，更新到 js/config.js 的 amap.securityJsCode<br>' +
        '③ 若 Key 设置了域名白名单，需加入「' + escHtml(location.hostname) + '」（或临时取消白名单测试）<br>' +
        '④ 请通过 http(s) 地址访问本页（如 VS Code Live Server），不要直接用 file:// 打开 index.html');
      toast('高德 3D 加载超时，请查看弹窗内提示与控制台', 'error');
    }, 8000);
  },

  close() {
    clearTimeout(this._watch);
    if (this._map) { try { this._map.destroy(); } catch (e) { /* 忽略 */ } this._map = null; }
    const m = document.getElementById('amap3dMask');
    if (m) m.remove();
  }
};
