/* ===== sync.js: 云端账号同步（LeanCloud REST，免 SDK） =====
   流程：填写 LeanCloud 应用凭证（一次性）→ 注册/登录账号 →
   登录时按时间戳自动双向对齐；之后本地每次保存自动推送云端。 */
const Sync = {
  session: null,     // {username, uid, token, objectId}
  cfg: null,         // {server, appId, appKey}
  localTs: 0,        // 本地数据时间戳
  _pushTimer: null,
  _busy: false,
  _applying: false
};

Sync.loadCfg = function () {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('cz-sync-cfg') || 'null'); } catch (e) { /* ignore */ }
  const base = (window.CONFIG && CONFIG.sync) || {};
  return {
    server: (saved && saved.server) || base.server || '',
    appId: (saved && saved.appId) || base.appId || '',
    appKey: (saved && saved.appKey) || base.appKey || ''
  };
};
Sync.cfgReady = function () {
  return !!(Sync.cfg && Sync.cfg.server && Sync.cfg.appId && Sync.cfg.appKey);
};

/* ---- REST 封装 ---- */
Sync.api = function (path, method, body) {
  const cfg = Sync.cfg;
  const headers = { 'X-LC-Id': cfg.appId, 'X-LC-Key': cfg.appKey, 'Content-Type': 'application/json' };
  if (Sync.session && Sync.session.token) headers['X-LC-Session'] = Sync.session.token;
  return fetch(cfg.server.replace(/\/+$/, '') + '/1.1/' + path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  }).then(r => r.json().then(j => {
    if (!r.ok || j.code) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }));
};

/* ---- 注册 / 登录 ---- */
Sync.signup = function (u, p) {
  return Sync.api('users', 'POST', { username: u, password: p }).then(res => {
    Sync.afterAuth(res);
    toast('注册成功，已登录 ☁');
  });
};
Sync.login = function (u, p) {
  return Sync.api('login', 'POST', { username: u, password: p }).then(res => {
    Sync.afterAuth(res);
    toast('登录成功 ☁');
  });
};
Sync.afterAuth = function (res) {
  Sync.session = { username: res.username, uid: res.objectId, token: res.sessionToken, objectId: null };
  localStorage.setItem('cz-sync-session', JSON.stringify(Sync.session));
  Sync.handshake();
};
Sync.logout = function () {
  Sync.session = null;
  localStorage.removeItem('cz-sync-session');
  Sync.renderPanel();
  toast('已退出同步账号（本地数据保留）');
};

/* ---- 登录后双向对齐：时间戳新者胜 ---- */
Sync.handshake = async function () {
  if (!Sync.cfgReady() || !Sync.session) return;
  try {
    const j = await Sync.api('classes/HouseMapSync?limit=1', 'GET');
    const rec = j.results && j.results[0];
    if (rec) {
      Sync.session.objectId = rec.objectId;
      if ((rec.ts || 0) > Sync.localTs) {
        Sync.applyCloud(rec);
        return; /* applyCloud 会刷新页面 */
      }
      await Sync.push();
      toast('已同步到云端 ☁');
    } else {
      await Sync.push();
      toast('本地数据已备份到云端 ☁');
    }
    Sync.renderPanel();
  } catch (e) {
    if (/210|211|invalid session/i.test(e.message)) { Sync.logout(); return; }
    toast('同步失败：' + e.message, 'error');
  }
};
Sync.applyCloud = function (rec) {
  try {
    const d = JSON.parse(rec.payload);
    if (!d || !d.communities) throw new Error('bad');
    Sync._applying = true;
    Store.data = d;
    if (!Array.isArray(Store.data.circles)) Store.data.circles = null;
    Sync.localTs = rec.ts || Date.now();
    localStorage.setItem('cz-sync-localts', String(Sync.localTs));
    Store.save();
    toast('已拉取云端最新数据，正在刷新…');
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    Sync._applying = false;
    toast('云端数据格式异常，已跳过', 'error');
  }
};

/* ---- 推送本地数据到云端 ---- */
Sync.push = async function () {
  if (!Sync.cfgReady() || !Sync.session || Sync._busy || Sync._applying) return;
  Sync._busy = true;
  try {
    Sync.localTs = Date.now();
    localStorage.setItem('cz-sync-localts', String(Sync.localTs));
    const body = { payload: JSON.stringify(Store.data), ts: Sync.localTs };
    if (Sync.session.objectId) {
      await Sync.api('classes/HouseMapSync/' + Sync.session.objectId, 'PUT', body);
    } else {
      body.ACL = {};
      body.ACL[Sync.session.uid] = { read: true, write: true };
      const j = await Sync.api('classes/HouseMapSync', 'POST', body);
      Sync.session.objectId = j.objectId;
      localStorage.setItem('cz-sync-session', JSON.stringify(Sync.session));
    }
    Sync.lastOk = Date.now();
    if (!$('syncPanel').classList.contains('hidden')) Sync.renderPanel();
  } catch (e) {
    toast('云端推送失败：' + e.message, 'error');
  }
  Sync._busy = false;
};
Sync.pull = function () {
  if (!Sync.cfgReady() || !Sync.session) return;
  Sync.api('classes/HouseMapSync?limit=1', 'GET').then(j => {
    const rec = j.results && j.results[0];
    if (!rec) { toast('云端还没有数据，请先「推送到云端」'); return; }
    Sync.session.objectId = rec.objectId;
    if ((rec.ts || 0) >= Sync.localTs) { Sync.applyCloud(rec); }
    else { toast('本地数据比云端新，已改为推送', 'error'); Sync.push(); }
  }).catch(e => toast('拉取失败：' + e.message, 'error'));
};

/* 本地每次保存后 2.5s 防抖自动推送 */
Sync.schedulePush = function () {
  if (!Sync.session || !Sync.cfgReady() || Sync._applying) return;
  clearTimeout(Sync._pushTimer);
  Sync._pushTimer = setTimeout(() => Sync.push(), 2500);
};
/* ---- 面板 UI ---- */
Sync.renderPanel = function () {
  const box = $('syncPanel');
  if (!box) return;
  let h = '<div class="sync-head"><b>☁ 账号同步</b><button type="button" id="syncClose" class="btn small">✕</button></div>';
  if (!Sync.cfgReady()) {
    h += '<div class="sync-guide">首次使用需创建一个免费 LeanCloud 应用（约 3 分钟）：<br>' +
      '① 打开 <b>console.leancloud.app</b> 用邮箱注册；<br>' +
      '② 创建应用（名称随意），选免费「开发版」；<br>' +
      '③ 「凭证」页复制 <b>AppID / AppKey</b>；<br>' +
      '④ 「设置→域名」复制 <b>API 服务器地址</b>（https://xxx.api.lncldglobal.com）；<br>' +
      '⑤ 填入下方并保存，即可注册/登录同步账号。</div>' +
      '<label>API 服务器<input type="text" id="sy-server" placeholder="https://xxx.api.lncldglobal.com" value="' + (Sync.cfg.server || '') + '"></label>' +
      '<label>AppID<input type="text" id="sy-appid" value="' + (Sync.cfg.appId || '') + '"></label>' +
      '<label>AppKey<input type="text" id="sy-appkey" value="' + (Sync.cfg.appKey || '') + '"></label>' +
      '<div class="sync-btns"><button type="button" id="sy-savecfg" class="btn primary">保存配置</button></div>';
  } else if (!Sync.session) {
    h += '<label>用户名<input type="text" id="sy-user" autocomplete="username" placeholder="用于跨设备同步"></label>' +
      '<label>密码<input type="password" id="sy-pass" autocomplete="current-password" placeholder="至少 4 位"></label>' +
      '<div class="sync-btns">' +
      '<button type="button" id="sy-login" class="btn primary">登录</button>' +
      '<button type="button" id="sy-signup" class="btn">注册并登录</button>' +
      '<button type="button" id="sy-changecfg" class="btn">改配置</button></div>' +
      '<div class="sync-tip">同一账号在任意设备登录后，数据自动保持一致。</div>';
  } else {
    h += '<div class="sync-me">已登录：<b>' + Sync.session.username + '</b>' +
      (Sync.lastOk ? '<br><small>上次推送 ' + new Date(Sync.lastOk).toLocaleTimeString() + '</small>' : '') + '</div>' +
      '<div class="sync-btns">' +
      '<button type="button" id="sy-push" class="btn primary">推送到云端</button>' +
      '<button type="button" id="sy-pull" class="btn">拉取云端</button>' +
      '<button type="button" id="sy-logout" class="btn danger">退出登录</button></div>' +
      '<div class="sync-tip">自动同步已开启：本地任何修改约 2.5 秒后自动推送云端；其他设备登录后自动拉取最新数据。</div>';
  }
  box.innerHTML = h;
  $('syncClose').onclick = () => box.classList.add('hidden');
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('sy-savecfg', () => {
    Sync.cfg = {
      server: $('sy-server').value.trim(),
      appId: $('sy-appid').value.trim(),
      appKey: $('sy-appkey').value.trim()
    };
    if (!Sync.cfgReady()) { toast('三项都需要填写', 'error'); return; }
    localStorage.setItem('cz-sync-cfg', JSON.stringify(Sync.cfg));
    toast('配置已保存，请注册/登录');
    Sync.renderPanel();
  });
  on('sy-changecfg', () => { localStorage.removeItem('cz-sync-cfg'); Sync.cfg = Sync.loadCfg(); Sync.renderPanel(); });
  on('sy-signup', () => {
    const u = $('sy-user').value.trim(), p = $('sy-pass').value;
    if (!u || p.length < 4) { toast('用户名必填、密码至少 4 位', 'error'); return; }
    Sync.signup(u, p).catch(e => toast('注册失败：' + e.message, 'error'));
  });
  on('sy-login', () => {
    const u = $('sy-user').value.trim(), p = $('sy-pass').value;
    if (!u || !p) { toast('请输入用户名和密码', 'error'); return; }
    Sync.login(u, p).catch(e => toast('登录失败：' + e.message, 'error'));
  });
  on('sy-push', () => Sync.push());
  on('sy-pull', () => Sync.pull());
  on('sy-logout', () => Sync.logout());
};

Sync.init = function () {
  Sync.cfg = Sync.loadCfg();
  Sync.localTs = +(localStorage.getItem('cz-sync-localts') || 0);
  try {
    const s = JSON.parse(localStorage.getItem('cz-sync-session') || 'null');
    if (s && s.token) Sync.session = s;
  } catch (e) { /* ignore */ }
  $('syncBtn').onclick = () => {
    Sync.renderPanel();
    $('syncPanel').classList.toggle('hidden');
  };
  /* 已登录则开机静默对齐 */
  if (Sync.session && Sync.cfgReady()) Sync.handshake();
};

/* 挂钩 Store.save：本地保存后自动调度云端推送 */
(function () {
  const orig = Store.save.bind(Store);
  Store.save = function () { const r = orig(); Sync.schedulePush(); return r; };
})();

document.addEventListener('DOMContentLoaded', Sync.init);