# 杭科院辅导员工作台

面向高校辅导员的**学生日常管理系统 + 内网多人协同工作台**。覆盖学生信息、谈心谈话、学业与心理预警、通知发布、审批中心、待办提醒、数据工作台等场景，附申请表模板库与 4 个 Excel 实用工具。

**纯内网本地化部署**：教师账号登录、数据按学生归属隔离、访问审计留痕，全部数据（SQLite 数据库 + 上传文件）仅存于校内服务器，不经过任何公有云服务。

## 功能一览

| 模块 | 说明 |
|------|------|
| 工作台 | 问候横幅、关键数据卡、预警名单、今日待办、待审批、类型分布 |
| 学生管理 | 分页/筛选/搜索、增删改查、详情、Excel 批量导入、家庭联系信息 |
| 谈心谈话 | 列表视图 + 按学生时间线视图（最新到最早），支持从学生页快捷记录 |
| 预警管理 | 红橙黄三级、处理闭环销号、跨模块联动跳转 |
| 通知发布 | 草稿 → 发布 → 撤回状态机，置顶与发布范围 |
| 审批中心 | 通过/驳回（含审批意见）、代学生登记申请 |
| 待办提醒 | 优先级、完成打卡、逾期高亮 |
| 模板汇总库 | 类别管理、上传下载、批量下载、失败明细导出 |
| 实用工具 | 智能排班 / Sheet 合并 / Excel 数据匹配 / Excel 数据拆分（iframe 内嵌，可扩展） |
| 系统管理 | 用户账号管理、访问日志审计（仅管理员） |

## 技术栈

- **前端**：Vite 5 · React 18 · TypeScript 5 · Ant Design 5 · React Router 6 · Day.js · SheetJS / ExcelJS / JSZip（均本地化，无外网 CDN）
- **服务端**：Node.js ≥ 22.5 · Express · node:sqlite（内置 SQLite，免装数据库）· JWT · bcrypt · multer
- **视觉**：「未来界面蓝」单色系 + 水彩晕染 + 卡片分层；支持亮/暗主题

## 目录结构

```
├── index.html / vite.config.ts / tsconfig.json   # 前端工程配置
├── src/                   # 前端源码（React + TS）
│   ├── api/               # 接口层（统一走 /api，JWT 自动注入）
│   ├── pages/             # 业务页面 + 登录页 + 管理页 + 实用工具
│   ├── components/ layouts/ hooks/ utils/ types/ mock/
├── server/                # 服务端（纯内网部署，详见 docs/deploy.md）
│   ├── index.js           # HTTPS 入口（默认 8443）：静态托管 dist + REST API
│   ├── lib/               # SQLite 建库与种子 / 鉴权 / 审计 / 数据范围
│   ├── routes/            # 业务接口（auth·users·students·conversations·warnings·
│   │                      #   notices·approvals·todos·templates·scheduler·dashboard·logs）
│   └── scripts/           # gen-cert.js 自签证书 / backup.js 备份
├── public/tools/          # 实用工具内嵌页面（HTML 自包含）+ 本地化运行库
├── public/templates/      # 模板库绑定的真实申请表文件
├── docs/deploy.md         # ★ 本地化部署与运维指南（必读）
└── scripts/               # 导入链路验证脚本
```

## 本地开发

```bash
# 1) 前端依赖（Node ≥ 18）
npm install

# 2) 服务端依赖（Node ≥ 22.5，使用内置 node:sqlite）
cd server && npm install

# 3) 启动服务端（https://localhost:8443，首次自动建库、生成自签证书、写入示例数据）
npm start          # 在 server/ 目录下

# 4) 启动前端开发服务器（/api 自动代理到 8443）
cd .. && npm run dev   # 打开 http://localhost:5173
```

**默认账号**（首次登录强制改密）：

| 账号 | 初始密码 | 角色 |
|------|----------|------|
| admin | Admin@2026 | 管理员（全部数据 + 用户管理 + 访问日志） |
| zhenann 等示例账号 | Hzky@123456 | 辅导员（仅见名下/共管学生及其记录） |

> 示例数据仅供演示，正式启用前可按 `docs/deploy.md` 第五节清理。

## 构建与部署

```bash
npm run build        # 前端构建 → dist/
cd server && npm start   # 服务端托管 dist/，教师浏览器访问 https://<内网IP>:8443
npm run backup       # 数据库一致性快照 + 上传文件打包（保留最近 30 份）
```

正式部署（常驻终端/内网服务器、防火墙、跨网段放通、备份恢复、迁移）请阅读 **[docs/deploy.md](docs/deploy.md)**。

## 环境变量（见 `.env.example`）

| 变量 | 默认 | 说明 |
|------|------|------|
| PORT | 8443 | 服务监听端口 |
| JWT_SECRET | 自动生成 | 留空则首次启动写入 `server/data/jwt.secret` |

服务端不自动加载 `.env` 文件，需通过启动环境注入（shell / pm2 / NSSM）。

## 安全说明

- 数据不出内网：服务仅监听局域网，请勿映射公网端口
- 传输加密：自签 HTTPS（教师设备首次信任证书即可，方法见 deploy.md 第四节）
- 权限：学生敏感数据按「主责 + 共管辅导员」隔离，管理员可见全部
- 审计：登录与所有写操作自动记录（时间/账号/IP/操作/结果）
- 首次登录强制改密；连续 5 次登录失败锁定 15 分钟
