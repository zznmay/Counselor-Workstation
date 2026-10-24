# 角色与权限体系设计

> 适用版本：角色管理重构（模块—页面—操作三级权限 + 数据范围 + 角色启停用）。
> 权限口径的唯一数据源是模块注册表：`server/lib/modules.js`（服务端）与 `src/constants/modules.ts`（前端镜像），两端保持同序同名。

## 1. 模型总览

```
角色 Role
├── 基础信息：name（1-20 字，唯一）/ key（标识，创建后不可改）/ description（≤100 字）/ disabled（启停用）
├── permissions   模块访问（模块 key 数组；admin 角色 = ['*']）
├── actions       操作权限（`module:*` 通配 或 `module:<actionKey>` 精确键；未勾任何操作 = 只读角色）
├── ownerModules  主负责模块（该模块最高权限：全院数据 + 全部管理操作）
└── dataScopes    数据范围（{moduleKey: 'all' | 'managed'}，仅 scopeable 模块；未配置默认 managed 带班）
```

- **用户 ↔ 角色**：`users.role` 为主角色 + `userRoles` 多对多集合；有效权限 = 所有**启用**角色的并集（取最宽）。
- **系统管理模块**（用户/角色/日志/数据管理）不在注册表内，始终仅 `admin` 角色可访问，不通过角色下发。

### 判定规则（`server/lib/permissions.js`）

| 判定 | 规则 |
|---|---|
| 模块访问 `hasPermission` | admin 恒真；否则 permissions 并集含模块 key |
| 操作权限 `hasAction` | 模块可访问 &&（actions 含 `*` / `module:*` / `module:action`） |
| 页面访问 `canAccessPage` | 模块可访问 &&（非 gated 页面放行；gated 页面需 `module:page-<key>`） |
| 数据范围 `dataScopeOfUser` | admin 或模块主负责 → `all`；任一角色配 `all` → `all`；否则 `managed`（带班） |
| 停用角色 | 一切授权贡献为空（permissions/actions/ownerModules/dataScopes 均不计），不删除分配关系 |

### 数据范围语义

- `all`（全量）：该模块的列表 / 详情 / 统计 / 导出覆盖全院学生；
- `managed`（带班）：仅 `classCounselors` 所辖班级的学生数据；
- **写操作与查看范围解耦**：新增 / 编辑 / 删除一律仍按带班收口（`canManageStudent`），主负责模块维持原有全量管理语义——「看得全」不等于「改得全」。
- 支持配置的模块（scopeable）：students、conversations、warnings、mentalHealth、funding、dormitories。todos 恒为本人数据；templates / tools / classes 为全员共享；dashboard 统计按各来源模块的范围派生。

## 2. 权限粒度（注册表）

| 模块 | 页面 | 操作 | 可配数据范围 |
|---|---|---|---|
| dashboard 工作台 | 概览页 | —（只读） | 派生 |
| students 学生名册 | 名册页 | 新增/编辑/删除/批量导入/批量导出（批量删除仅管理员） | ✓ |
| conversations 谈心谈话 | 记录页 | 新增/编辑/删除 | ✓ |
| warnings 预警管理 | 预警页 | 录入/处理/编辑/删除 | ✓ |
| mentalHealth 心理健康 | 关注列表页 | 管理操作随「主负责」开放（不做逐操作勾选） | ✓ |
| mentalInterview 心理访谈 | 心理健康页内（功能级） | 新增/编辑/作废访谈 | — |
| todos 待办提醒 | 待办页 | 新增/编辑完成/删除 | —（本人） |
| funding 资助管理 | 认定名册页 | 新增/编辑/复核确认/取消/重新认定/批量/导入/导出/学年结转 | ✓ |
| templates 模板汇总库 | 模板页 | 上传/下载/重命名/删除（类别管理仅管理员） | —（共享） |
| tools 实用工具 | 工具广场 | —（访问即用） | — |
| classes 班级管理 | 班级管理页 | 新增/编辑/删除/导入名单/待同步建号 | —（字典） |
| classes（gated 页面） | **年级管理页**（独立授权 `classes:page-grades`） | 新增/编辑/删除年级 | — |
| dormitories 寝室管理 | 分配页 | 新增/编辑/删除/批量导出（批量导入随主负责） | ✓ |

## 3. 内置角色默认权限（与升级前行为逐点一致）

| 角色 | 模块 | 操作 | 数据范围 | 主负责 |
|---|---|---|---|---|
| admin 系统管理员（不可编辑/停用/删除） | 全部 + 系统管理 | 全部 | 全量 | 全部 |
| counselor 辅导员 | dashboard/students/conversations/warnings/mentalHealth/todos/funding/templates/tools/dormitories | 各模块 `module:*` | **students、dormitories = 全量**；谈话/预警/心理/资助 = 带班 | 无 |
| headTeacher 班主任 | mentalHealth + mentalInterview | 访谈全部操作 | 心理健康 = 带班 | 无 |

常见自定义角色建议：「只读辅导员」= 业务模块 + 带班 + 不勾任何操作；「资助专员」= funding（全量或带班按需）+ funding 全部操作 + students 查看（带班）。

## 4. 生效逻辑（无需重新登录）

- **服务端**：`authMiddleware` 每次请求实时读取用户与角色集合解析权限，保存 / 停用 / 调整用户角色**下一次请求即生效**；
- **前端**：BasicLayout 在路由切换与窗口聚焦（5s 节流）时刷新 `/auth/me`；权限指纹（role/roleKeys/permissions/actions/classIds/ownerModules/dataScopes）变化时派发 `workbench:session-updated`，已挂载页面实时重算按钮显隐与数据范围；被收回模块的页面即时跳转 `/forbidden`；
- 服务端是安全边界，前端按钮显隐只是体验层收敛。

## 5. 新增模块 / 操作的扩展方式

1. 在 `server/lib/modules.js` 与 `src/constants/modules.ts` **同步**追加模块记录（key/name/group/pages/actions/scopeable）；
2. 菜单、路由守卫、权限配置树、操作校验自动纳入，无需改配置；
3. 新模块默认仅系统管理员可见，需在「角色管理 → 配置权限」为角色授权；
4. **已配 `module:*` 通配的角色自动获得该模块后续新增的操作**；被精确收窄过的角色不自动放开，需管理员确认；
5. 服务端业务路由挂载 `requirePermission('<key>')` / `requireAction('<key>','<action>')`，前端对应页面按钮用 `canAccessModule` / `canAction` 收敛。

## 6. 存储、迁移与兼容

- `roles` 表新增 `actions` / `dataScopes` / `disabled` 三列；老库启动时幂等补列并回填：存量角色按原 permissions 回填 `module:*`（可访问 = 全部操作），内置辅导员回填 `{students:'all', dormitories:'all', 其余 managed}`——**升级前后运行时行为完全一致**；
- 备份 / 恢复 / 迁移包按表导出，新列自动携带；
- counselor「随版本自动补新模块」逻辑保留：仅当模块集合仍为初始默认集且操作权限全为通配（管理员从未自定义）时自动补配；
- 删除护栏：内置角色、仍有用户引用（主角色或 userRoles）的角色不可删除；`admin` 角色不可编辑、不可停用。

## 7. 管理入口

- 角色列表 `/admin/roles`（仅管理员）：名称 / 标识 / 说明 / 状态 / 权限概览 / 用户数；操作 = 配置权限 / 编辑 / 停用·启用 / 删除；新增/编辑弹窗只维护基础信息（标识仅创建可填，`^[a-z][a-z0-9_]{1,29}$`，保留字 admin/counselor/headTeacher/demo）；
- 权限配置 `/admin/roles/:id/permissions`：模块分组折叠面板，每模块含「可访问开关 + 数据范围 Radio + 主负责 Checkbox + 页面/操作勾选（全选/清空，勾满自动存为通配）」，顶部权限概览统计；admin 角色整页只读；移动端提供只读概览；
- 停用的角色在用户管理下拉中标注「已停用」且不可新选（存量分配保留展示）。
