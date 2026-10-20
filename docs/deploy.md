# 本地化部署与运维指南（纯内网，无公有云依赖）

本指南说明如何将「辅导员工作台」部署到学院内网（常驻终端或内网服务器），供多位教师在有线局域网 / 校园 WiFi 下共同使用。**所有数据（数据库、上传文件、备份）仅存在于校园网内的这台机器及其备份盘，不经过任何公有云服务。**

## 一、系统组成

```
server/                 服务端（本目录，独立依赖）
├── index.js            HTTPS 服务入口：托管前端 dist/ + REST API
├── lib/                SQLite 数据库、鉴权、审计、数据范围
├── routes/             业务接口（学生/谈话/预警/通知/审批/待办/模板/排班/日志）
├── scripts/            gen-cert.js（自签证书）、backup.js（备份）
├── data/               ★ 运行时生成：app.db + uploads/ + backups/（即系统全部数据）
└── certs/              自签 HTTPS 证书
```

技术栈：Node.js ≥ 22.5（推荐 24 LTS，使用内置 `node:sqlite`，无需数据库软件）、Express、JWT、bcrypt。前端为零外链（vendor 库全部本地化），断外网不影响使用。

## 二、首次部署（约 15 分钟）

```bash
# 1. 构建前端（在有外网的开发机执行一次）
npm install && npm run build          # 项目根目录，产出 dist/

# 2. 安装服务端依赖（部署机需临时联网，或直接拷贝整个 server/node_modules）
cd server && npm install

# 3. 生成自签证书（首次启动也会自动生成）
npm run gen-cert

# 4. 启动服务（默认 https://0.0.0.0:8443）
npm start
```

首次启动自动完成：建库建表 → 写入管理员与示例数据 → 生成自签证书。

**默认账号**（首次登录强制改密，请在教师使用前完成修改）：

| 账号 | 初始密码 | 角色 |
|------|----------|------|
| admin | Admin@2026 | 管理员（可见全部数据、用户管理、访问日志） |
| zhenann / hanwen / ... | Hzky@123456 | 辅导员（按学生归属隔离） |

## 三、常驻运行（开机自启 + 崩溃自启）

- **Windows**：安装 [NSSM](https://nssm.cc)，`nssm install Workbench "C:\Program Files\nodejs\node.exe" "D:\workbench\server\index.js"`，设置启动目录后启动服务；
- **macOS / Linux**：`npm i -g pm2 && pm2 start index.js --name workbench && pm2 startup && pm2 save`；
- 建议在电源设置中关闭睡眠、设置来电自动开机；BIOS 开启「断电恢复后自动开机」。

## 四、网络访问（有线局域网 ↔ 校园 WiFi）

1. 在终端的网络设置中查看内网 IP（服务启动日志会打印），并请网络中心做 **IP-MAC 绑定（DHCP 保留）**，保证 IP 固定；
2. 教师访问 `https://<服务器IP>:8443`；有条件建议向网络中心申请内网 DNS 域名（如 `gzry.hzks.edu.cn`），访问更友好；
3. **跨网段放通**：校园 WiFi 与办公有线网通常为不同 VLAN，需请网络中心放通「WiFi 网段 → 服务器 IP 的 TCP 8443」一条访问控制。放通后两网访问同一服务器、同一地址，**切换网络时无需任何同步操作**；
4. 教师设备首次访问：浏览器提示证书不受信任 → 点「高级 → 继续访问」即可（自签证书正常现象；也可将 `certs/cert.pem` 分发安装信任）。

## 五、账号与数据初始化

1. 用 `admin` 登录（首次强制改密）→ 系统管理 → 用户管理：为每位老师开设账号（单个创建时手动设置初始密码；Excel 批量导入的账号初始密码由系统自动生成为「Hzpt@用户名」，首次登录强制修改）；
2. 学生归属：新增/编辑学生时可指定主责辅导员与共管老师；辅导员登录后只能看到自己名下/共管的学生及其谈话、预警、审批记录，管理员可见全部；
3. **清空示例数据**（正式启用前可选）：停止服务后删除 `server/data/app.db` 前先确认已备份，或用 SQLite 工具执行 `DELETE FROM students;` 等语句按表清理业务数据（保留 users 表）。

## 六、备份与恢复

```bash
# 手动/定时备份（Windows 用任务计划程序、macOS/Linux 用 cron 每晚执行）
cd server && npm run backup
# 产出：server/data/backups/<时间戳>/（app.db 一致性快照 + uploads 全量），自动保留最近 30 份
```

- **恢复**：停止服务 → 用备份的 `app.db` 覆盖 `server/data/app.db` → 用备份的 `uploads/` 覆盖 `server/data/uploads/` → 启动服务；
- **迁移到内网服务器**：停止服务 → 整体拷贝 `server/`（含 data/、certs/、node_modules/）→ 新机器 `npm start`。IP 变更时请网络中心同步更新 DNS/放通规则。

建议每学期做一次恢复演练，并确认备份目录所在磁盘有足够空间。

## 七、安全要点清单

- 服务仅监听校园网（不映射公网端口、不做内网穿透、不装公网远程工具）；
- 教师账号由管理员开设，启用登录失败锁定（5 次失败锁 15 分钟）、首次登录强制改密；
- 所有接口需 JWT 鉴权；学生名册基础信息全员可见，谈话/预警/审批仅所带班级辅导员可见可维护（按用户管理分配的班级判定），接口层同样校验；
- 访问日志自动记录全部登录与写操作（时间/账号/IP/操作/结果），系统管理 → 访问日志可查询；
- 模板上传限制格式（doc/docx/xls/xlsx/pdf）与大小（≤10MB），重名拦截；
- 终端系统保持更新；不要在终端上安装来路不明的软件。

## 八、常见问题

| 现象 | 处理 |
|------|------|
| 教师打开页面提示证书不受信任 | 正常现象，点「高级 → 继续访问」；或分发 `certs/cert.pem` 信任 |
| WiFi 下无法访问、有线可以 | 跨 VLAN 未放通，联系网络中心放通 WiFi 网段 → 服务器 8443 |
| 服务启动报端口占用 | `netstat -ano | findstr 8443`（Windows）找到进程结束，或改 `PORT` 环境变量 |
| 忘记 admin 密码 | 停止服务 → 用任意 SQLite 工具将 users 表 admin 的 passwordHash 更新为 bcrypt 新值，并置 mustChangePassword=1 |
| 更换终端 | 见「迁移到内网服务器」，数据整体拷贝 |
