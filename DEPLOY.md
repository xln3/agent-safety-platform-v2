# 部署到公网服务器（39.105.175.14）

> 本仓库的代码在 dev 机本地（`localhost:3002`）已可用，但 dev 机的真实公网 IP 不是 `39.105.175.14`。要让甲方通过 `http://39.105.175.14:3002` 访问，必须把代码部署到那台目标服务器上，然后开放 3002 端口。

## 一、目标服务器准备

```bash
# 系统依赖（Ubuntu/Debian）
sudo apt-get update && sudo apt-get install -y \
  curl git build-essential mysql-client \
  python3.10 python3.10-venv python3-pip

# Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# MySQL 8.x（按需调整密码）
sudo apt-get install -y mysql-server
sudo mysql -e "
CREATE DATABASE IF NOT EXISTS agent_safety_platform CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'asp_user'@'localhost' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL ON agent_safety_platform.* TO 'asp_user'@'localhost';
"
```

## 二、放行 3002 端口

```bash
# Ubuntu ufw（直连场景）
sudo ufw allow 3002/tcp

# Aliyun 安全组（控制台）
# 入方向规则 → 添加：协议 TCP / 端口 3002 / 授权对象 0.0.0.0/0
```

## 三、拉代码 + 安装

```bash
git clone https://github.com/xln3/agent-safety-platform-v2.git
cd agent-safety-platform-v2

# 后端
cd server
cp .env.example .env   # 编辑 DB_PASSWORD / 其他凭据
npm ci
npm run build          # 生成 server/dist/
cd ..

# 前端
npm ci
npm run build          # 生成 dist/
```

## 四、（可选）预热 Python venvs + 数据集

```bash
cd server
npm run setup:venvs       # 70 个 benchmark venv（约 30-60 分钟）
npm run prepare:datasets  # 离线数据集（约 20-40 分钟）
```

跳过此步也能跑 — eval 阶段会按需懒加载，但首次每个 benchmark 会慢 1-3 分钟。

## 五、启动

```bash
cd server
NODE_ENV=production node dist/index.js
# 监听 0.0.0.0:3002
# 同端口提供 SPA + /api/* 路由
```

后台跑用 systemd 或 pm2：

```bash
# systemd 例
sudo tee /etc/systemd/system/asp.service <<'EOF'
[Unit]
Description=Agent Safety Platform
After=network.target mysql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/agent-safety-platform-v2/server
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now asp
sudo systemctl status asp
```

## 六、验证

```bash
# 服务器上
curl -sI http://localhost:3002/ | head -3
curl -s http://localhost:3002/api/eval/jobs?pageSize=1 | head -c 200

# 浏览器（外部）
http://39.105.175.14:3002/        → 智能体管理首页
http://39.105.175.14:3002/eval    → 评估任务列表
```

## 七、常见空白页排查

| 现象 | 原因 | 处置 |
|---|---|---|
| 浏览器空白，DevTools Network 看不到任何请求 | 安全组未放行 3002 / ufw 拦截 | 第二步 |
| Network 200 拿到 index.html，但 `/assets/*.js` 404 | 没跑 `npm run build` 生成 `dist/` | 第三步 |
| index.html 加载，JS 报错 `Cannot find module` | 路由 fallback 漏配 / 静态目录路径错 | 看 `server/src/app.ts` 静态服务段是否指向项目根的 `dist/` |
| `502 Bad Gateway` | 前面有 nginx/Caddy 但 upstream 配错 | 直接访问 `:3002` 绕过反代验证 |
| 跨网段访问能 ping 通但 curl 超时 | 云厂商安全组 / 路由 ACL 拦截 | 检查 VPC 防火墙规则 |

## 八、本仓库 Q3 代码层面已做的事

- `server/src/index.ts`：`server.listen(PORT, '0.0.0.0', ...)` — 接受任意网卡入站
- `server/src/app.ts`：`express.static(path.resolve(__dirname, '../../dist'))` 提供前端 bundle，`app.get(/^\/(?!api(?:\/|$)).*/, ...)` 把非 `/api/*` 的路径回退到 `index.html`，让 React Router deep-link 可用
- 同源同端口 `:3002` 提供 `/` (SPA) + `/api/*` (REST + SSE) — 不需要单独跑前端 dev server，不存在 CORS 问题

---

## 九、本机当前部署快照（39.105.175.14，2026-04-28 落地）

> 这一节是事实记录，不是参考模板。下面的命令甲方复制即用。

**访问入口**：`http://39.105.175.14:3002/`（首页 / SPA）、`http://39.105.175.14:3002/eval`（评估列表）、`http://39.105.175.14:3002/api/health`（健康检查）

**进程形态**：systemd 服务 `asp-refractor.service`，自启，崩溃自动 5 秒后重启。`ts-node-dev` 已退役，跑的是编译后的 `node dist/index.js`。

**项目位置**：`/home/xln/agent-safety-platform-refractor`

**甲方日常 3 条命令**：

```bash
# 看服务状态
sudo systemctl status asp-refractor

# 重启（拉了新代码 / 改了配置后）
sudo systemctl restart asp-refractor

# 看实时日志（Ctrl+C 退出）
sudo journalctl -u asp-refractor -f
```

**改了代码怎么办**（甲方接班场景）：

```bash
cd /home/xln/agent-safety-platform-refractor
git pull origin main
cd server && npm install --omit=dev && npm run build   # 编译后端
cd ..      && npm install              && npm run build   # 编译前端
sudo systemctl restart asp-refractor
```

**unit 文件位置**：`/etc/systemd/system/asp-refractor.service`，仓库内备份 `ops/asp-refractor.service`（首次部署或损坏后用 `sudo cp ops/asp-refractor.service /etc/systemd/system/ && sudo systemctl daemon-reload` 恢复）

**外网验证**（任何机器都可跑，不依赖这台机）：

```bash
curl -s http://39.105.175.14:3002/api/health
# 期望：{"code":0,"message":"success","data":{"status":"ok",...}}
```
