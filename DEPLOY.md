# 常州购房地图 · 发布到互联网（两种方式）

> 发布前先读「安全提醒」（文末），涉及高德 Key 白名单。

## 方式一：Netlify Drop（推荐，最快，约 2 分钟）
1. 打开 https://app.netlify.com/drop
2. 用 GitHub / Google / 邮箱注册一个免费账号（已有则登录）
3. 把本文件夹里 **除 .vscode 和 DEPLOY.md 以外的全部内容**（index.html、css、js、README.md）
   拖进页面的虚线框；也可以直接把打包好的 `常州购房地图-发布包.zip` 拖进去（Netlify 会自动解压）
4. 十几秒后生成网址，形如 `https://xxx-yyy-zzz.netlify.app` —— 即可在任何设备打开
5. （可选）Site configuration → Change site name 改成好记的名字，如 `cz-house-map.netlify.app`

## 方式二：GitHub Pages（适合已有 GitHub 账号）
1. 打开 https://github.com/new ，仓库名如 `cz-house-map`，可见性选 **Public**，Create
2. 在本文件夹执行：
   ```
   git init
   git add index.html css js README.md
   git commit -m "常州购房地图"
   git branch -M main
   git remote add origin https://github.com/你的用户名/cz-house-map.git
   git push -u origin main
   ```
   （首次 push 会弹出浏览器要求登录 GitHub 授权）
3. 仓库页 → Settings → Pages → Source 选 "Deploy from a branch"，
   Branch 选 `main` / `(root)` → Save
4. 约 1 分钟后上线：`https://你的用户名.github.io/cz-house-map/`

## 上线后必做
1. **高德 Key 白名单**：登录 https://console.amap.com → 你的 Key → 域名白名单，
   加入新域名（`xxx.netlify.app` 或 `你的用户名.github.io`），防止别人盗用你的 Key
2. **导入数据**：线上是全新环境（数据存在各自浏览器里），打开网址后点「⬆ 导入」
   选择 `常州市购房地图数据.json` 即可恢复全部小区
3. 以后本机改了代码：Netlify 重新拖一次新包 / GitHub `git push` 后自动更新

## 安全提醒
- `js/config.js` 里的高德 Key 和安全密钥会随网页公开（浏览器里 F12 可见，属正常现象），
  只要设置了**域名白名单**，别人拿到也无法在其他网站使用
- 不要把你的小区数据 JSON（含个人备注）上传到公开仓库或网盘公开链接
