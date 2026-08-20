/* ===== sync.js：跨设备账号同步（Gitee / GitHub 私有仓库云存储，纯 REST） =====
   - 默认推荐国内访问稳定的 Gitee；也支持 GitHub（已有 GitHub 账号可免注册）。
   - 凭据：个人访问令牌（最小权限），只存浏览器本地 localStorage，不上传。
   - 数据：私有仓库 / 私密 Gist 中的 data.json，内容 { ts, data }，按账号隔离。
   - 自动同步：Store.save() 触发防抖自动推送；拉取覆盖时刷新页面。
*/
const Sync = { session: null, localTs: 0, _pushTimer: null, _busy: false, _applying: false, lastOk: 0 };

Sync.loadSession = function () {
  try { return JSON.parse(localStorage.getItem('cz-sync-session') || 'null'); } catch (e) { return null; }
};

/* UTF-8 安全 base64（Gitee 接口要求内容 base64） */
function b64e(s) { return btoa(unescape(encodeURIComponent(s))); }
function b64d(s) { return decodeURIComponent(escape(atob(s))); }

/* 统一请求封装：Gitee 用 query 传令牌 + 表单正文，GitHub 用 Authorization 头 + JSON 正文。
   响应统一做“安全 JSON 解析”：空正文 / HTML 错误页都不会再导致 JSON 解析崩溃。 */
function apiCall(url, method, token, body) {
  const isGitee = url.indexOf('gitee.com') >= 0;
  const headers = { Accept: 'application/json' };
  if (!isGitee && token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (body) {
    if (isGitee) {
      // Gitee v5 接口参数为 formData：用表单编码（同时避免 CORS 预检）
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = Object.keys(body).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(body[k])).join('&');
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  return fetch(url, { method: method || 'GET', headers: headers, body: payload })
    .then(r => r.text().then(text => {
      let j = null;
      if (text) {
        try { j = JSON.parse(text); }
        catch (e) {
          j = { message: text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) };
        }
      }
      if (!r.ok) {
        let msg = (j && (j.message || j.error)) || '';
        if (r.status === 401) msg = '令牌无效或已过期（401），请重新生成';
        else if (r.status === 403 && !msg) msg = '权限不足（403），请检查令牌权限';
        if (!msg) msg = 'HTTP ' + r.status;
        const err = new Error(msg); err.status = r.status;
        throw err;
      }
      return j;
    }));
}
window.apiCall = apiCall;

const SyncProviders = {
  gitee: {
    name: 'Gitee（国内推荐）',
    base: 'https://gitee.com/api/v5',
    user(token) {
      return apiCall(this.base + '/user?access_token=' + encodeURIComponent(token)).then(j => ({ username: j.login }));
    },
    ensureRepo(token, username) {
      const repoUrl = this.base + '/repos/' + username + '/house-map-sync?access_token=' + encodeURIComponent(token);
      const get = () => apiCall(repoUrl);
      return get().catch(e => {
        if (e.status && e.status !== 404) throw e; // 401/403 等真实错误直接抛出
        return apiCall(this.base + '/user/repos', 'POST', token,
          { access_token: token, name: 'house-map-sync', private: 'true', auto_init: 'true',
            description: '常州买房地图同步数据（私有）' })
          .then(() => get()); // 创建后复查，确保仓库确实存在
      });
    },
    find(token, username) {
      const u = this.base + '/repos/' + username + '/house-map-sync/contents/data.json?access_token=' + encodeURIComponent(token);
      return apiCall(u)
        .then(j => {
          if (!j || !j.content) return null; // 空文件/异常结构视为“云端暂无数据”
          let doc = null;
          try { doc = JSON.parse(b64d(j.content)); } catch (e) { return null; }
          return { id: j.sha, doc: doc };
        })
        .catch(e => (e.status === 404 || /404|not found/i.test(e.message) ? null : Promise.reject(e)));
    },
    save(token, username, id, doc) {
      const u = this.base + '/repos/' + username + '/house-map-sync/contents/data.json';
      const body = { access_token: token, content: b64e(JSON.stringify(doc)), message: 'sync ' + new Date().toISOString() };
      if (id) body.sha = id;
      return apiCall(u, id ? 'PUT' : 'POST', token, body)
        .then(j => {
          const sha = j && j.content && j.content.sha;
          if (sha) return { id: sha };
          // 个别情况下响应正文为空：回查一次文件 sha
          return apiCall(this.base + '/repos/' + username + '/house-map-sync/contents/data.json?access_token=' + encodeURIComponent(token))
            .then(f => ({ id: (f && f.sha) || id }));
        });
    }
  },
  github: {
    name: 'GitHub',
    base: 'https://api.github.com',
    user(token) { return apiCall(this.base + '/user', 'GET', token).then(j => ({ username: j.login })); },
    ensureRepo() { return Promise.resolve(); },
    find(token) {
      return apiCall(this.base + '/gists?per_page=100', 'GET', token).then(list => {
        const g = (list || []).find(x => x.description === 'cz-house-map-sync');
        if (!g) return null;
        return apiCall(this.base + '/gists/' + g.id, 'GET', token).then(full => {
          const f = full.files && full.files['data.json'];
          if (!f || !f.content) return null;
          return { id: g.id, doc: JSON.parse(f.content) };
        });
      });
    },
    save(token, username, id, doc) {
      const body = { files: { 'data.json': { content: JSON.stringify(doc) } } };
      if (id) return apiCall(this.base + '/gists/' + id, 'PATCH', token, body).then(() => ({ id: id }));
      body.description = 'cz-house-map-sync';
      body.public = false;
      return apiCall(this.base + '/gists', 'POST', token, body).then(j => ({ id: j.id }));
    }
  }
};
window.SyncProviders = SyncProviders;

/* ---- 核心流程 ---- */
Sync.start = function (providerKey, token, onDone, onError) {
  const p = SyncProviders[providerKey];
  if (!p) { onError && onError('未知服务'); return; }
  p.user(token)
    .then(info => p.ensureRepo(token, info.username).then(() => info))
    .then(info => {
      Sync.session = { provider: providerKey, token: token, username: info.username, docId: null };
      localStorage.setItem('cz-sync-session', JSON.stringify(Sync.session));
      return Sync.handshake();
    })
    .then(() => { onDone && onDone(); })
    .catch(e => {
      Sync.session = null;
      localStorage.removeItem('cz-sync-session');
      onError && onError(e.message || '连接失败');
    });
};

Sync.handshake = function () {
  const p = SyncProviders[Sync.session.provider];
  return p.find(Sync.session.token, Sync.session.username).then(found => {
    if (!found) return Sync._pushNow();
    Sync.session.docId = found.id;
    const cloud = found.doc || {};
    if ((cloud.ts || 0) > Sync.localTs) return Sync._applyCloud(cloud);
    return Sync._pushNow();
  });
};

Sync._pushNow = function () {
  const p = SyncProviders[Sync.session.provider];
  const doc = { ts: Date.now(), data: Store.data };
  return p.save(Sync.session.token, Sync.session.username, Sync.session.docId, doc).then(res => {
    if (res && res.id) Sync.session.docId = res.id;
    localStorage.setItem('cz-sync-session', JSON.stringify(Sync.session));
    Sync.localTs = doc.ts;
    Sync.lastOk = Date.now();
    return true;
  });
};

Sync._applyCloud = function (cloud) {
  Sync._applying = true;
  try {
    const incoming = cloud.data || {};
    Store.data.communities = incoming.communities || {};
    Store.data.records = incoming.records || {};
    if (incoming.circles !== undefined) Store.data.circles = incoming.circles;
    Sync.localTs = cloud.ts || Date.now();
    Store._persist();
    localStorage.setItem('cz-sync-last-ok', String(Date.now()));
    Sync.lastOk = Date.now();
    setTimeout(function () { location.reload(); }, 300);
  } finally { Sync._applying = false; }
  return true;
};

Sync.pull = function () {
  if (!Sync.session) return Promise.reject(new Error('请先登录'));
  const p = SyncProviders[Sync.session.provider];
  return p.find(Sync.session.token, Sync.session.username).then(found => {
    if (!found) { toast('云端暂无数据', true); return false; }
    Sync.session.docId = found.id;
    const cloud = found.doc || {};
    if ((cloud.ts || 0) <= Sync.localTs) { toast('云端没有更新的数据', true); return false; }
    return Sync._applyCloud(cloud);
  });
};

Sync.push = function () {
  if (!Sync.session) return Promise.reject(new Error('请先登录'));
  if (Sync._busy) return Promise.resolve(false);
  Sync._busy = true;
  return Sync._pushNow()
    .then(() => { Sync._busy = false; toast('☁ 已推送到云端'); return true; })
    .catch(e => { Sync._busy = false; throw e; });
};

/* 保存后自动推送（防抖 2.5s，拉取覆盖期间跳过） */
Sync.schedulePush = function () {
  if (!Sync.session || Sync._applying) return;
  clearTimeout(Sync._pushTimer);
  Sync._pushTimer = setTimeout(() => {
    Sync.push().catch(e => console.warn('[sync] 自动推送失败：', e.message));
  }, 2500);
};

Sync.logout = function () {
  Sync.session = null;
  localStorage.removeItem('cz-sync-session');
};


/* ---- 面板 UI ---- */
function _esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

Sync.renderPanel = function () {
  const panel = document.getElementById('syncPanel');
  if (!panel) return;
  const guide = {
    gitee: '① 注册/登录 <a href="https://gitee.com" target="_blank">gitee.com</a>（手机号即可，国内速度快）<br>' +
      '② 打开 <a href="https://gitee.com/profile/personal_access_tokens" target="_blank">个人访问令牌页</a>，点「生成新令牌」<br>' +
      '③ 权限只勾选 <b>projects</b>，生成后复制粘贴到下方<br>' +
      '④ 首次连接会自动创建私有仓库 house-map-sync 存放数据',
    github: '① 打开 <a href="https://github.com/settings/tokens" target="_blank">Tokens 页</a> → Generate new token (classic)<br>' +
      '② 权限只勾选 <b>gist</b>，生成后复制粘贴到下方<br>' +
      '③ 数据存为该账号的一条私密 Gist，不会公开'
  };
  const setProvider = function (key) {
    const g = panel.querySelector('#syncGuide');
    if (g) g.innerHTML = guide[key] || '';
  };
  if (!Sync.session) {
    panel.innerHTML =
      '<div class="sync-box"><div class="sync-panel-title">☁ 云同步 · 选择服务</div>' +
      '<label class="sync-opt"><input type="radio" name="syncProvider" value="gitee" checked> Gitee（国内推荐，免费）</label>' +
      '<label class="sync-opt"><input type="radio" name="syncProvider" value="github"> GitHub（已有账号可免注册）</label>' +
      '<div class="sync-guide" id="syncGuide"></div>' +
      '<div class="sync-field">访问令牌（只存本机浏览器）' +
      '<input id="syncToken" type="password" placeholder="粘贴个人访问令牌" autocomplete="off"></div>' +
      '<div class="sync-actions"><button class="btn primary" id="syncLoginBtn">保存并连接</button>' +
      '<button class="btn" id="syncCloseBtn">取消</button></div>' +
      '<div class="sync-status" id="syncStatus"></div></div>';
    setProvider('gitee');
    panel.querySelectorAll('input[name="syncProvider"]').forEach(function (el) {
      el.addEventListener('change', function () { setProvider(el.value); });
    });
    panel.querySelector('#syncLoginBtn').addEventListener('click', function () {
      const key = panel.querySelector('input[name="syncProvider"]:checked').value;
      const token = document.getElementById('syncToken').value.trim();
      const st = document.getElementById('syncStatus');
      if (!token) { st.textContent = '请粘贴访问令牌'; return; }
      st.textContent = '正在连接验证…';
      Sync.start(key, token,
        function () { st.textContent = ''; Sync.renderPanel(); Sync.updateBtn(); toast('☁ 已连接，开始自动同步'); },
        function (msg) { st.textContent = '连接失败：' + msg; });
    });
    panel.querySelector('#syncCloseBtn').addEventListener('click', hideSyncPanel);
    return;
  }
  const p = SyncProviders[Sync.session.provider];
  const last = Sync.lastOk ? new Date(Sync.lastOk).toLocaleString() : '—';
  panel.innerHTML =
    '<div class="sync-box"><div class="sync-panel-title">☁ 云同步</div>' +
    '<div class="sync-status">已登录：<b>' + _esc(p.name) + '</b> · ' + _esc(Sync.session.username) + '</div>' +
    '<div class="sync-status">上次成功同步：' + last + '</div>' +
    '<div class="sync-status">本地修改保存后自动推送；在其他设备打开会自动拉取最新数据。</div>' +
    '<div class="sync-actions"><button class="btn primary" id="syncPushBtn">⬆ 立即推送</button>' +
    '<button class="btn" id="syncPullBtn">⬇ 拉取云端</button>' +
    '<button class="btn danger" id="syncLogoutBtn">退出登录</button>' +
    '<button class="btn" id="syncCloseBtn">关闭</button></div>' +
    '<div class="sync-status" id="syncStatus"></div></div>';
  panel.querySelector('#syncPushBtn').addEventListener('click', function () {
    const st = document.getElementById('syncStatus');
    st.textContent = '推送中…';
    Sync.push()
      .then(() => { st.textContent = '推送成功 ' + new Date().toLocaleTimeString(); })
      .catch(e => { st.textContent = '推送失败：' + e.message; });
  });
  panel.querySelector('#syncPullBtn').addEventListener('click', function () {
    const st = document.getElementById('syncStatus');
    st.textContent = '拉取中…';
    Sync.pull().catch(e => { st.textContent = '拉取失败：' + e.message; });
  });
  panel.querySelector('#syncLogoutBtn').addEventListener('click', function () {
    Sync.logout(); Sync.renderPanel(); Sync.updateBtn();
  });
  panel.querySelector('#syncCloseBtn').addEventListener('click', hideSyncPanel);
};

function toggleSyncPanel() {
  const panel = document.getElementById('syncPanel');
  if (!panel) return;
  if (panel.classList.contains('hidden')) { Sync.renderPanel(); panel.classList.remove('hidden'); }
  else panel.classList.add('hidden');
}
window.toggleSyncPanel = toggleSyncPanel;

function hideSyncPanel() {
  const panel = document.getElementById('syncPanel');
  if (panel) panel.classList.add('hidden');
}

Sync.updateBtn = function () {
  const btn = document.getElementById('syncBtn');
  if (!btn) return;
  btn.textContent = Sync.session ? '☁ 已同步：' + Sync.session.username : '☁ 同步';
};

Sync.init = function () {
  const btn = document.getElementById('syncBtn');
  if (btn) btn.addEventListener('click', toggleSyncPanel);
  const s = Sync.loadSession();
  if (s && s.provider && s.token) {
    Sync.session = s;
    Sync.updateBtn();
    Sync.handshake().catch(e => console.warn('[sync] 握手失败：', e.message));
  }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', Sync.init);
else Sync.init();

