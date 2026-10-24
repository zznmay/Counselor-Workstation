import { ArrowLeftOutlined, LockOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Collapse,
  Descriptions,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import type { CollapseProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { getRoles, updateRole } from '@/api/roles';
import PageHeader from '@/components/PageHeader';
import { ACTIONS_OF_MODULE, APP_MODULES, MODULE_GROUPS } from '@/constants/modules';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { DataScope, Role } from '@/types';

/** 配置草稿：保存时整体提交（permissions/actions/ownerModules/dataScopes） */
interface Draft {
  permissions: string[];
  /** 可能含 `module:*` 通配（勾满时自动折叠为通配，新增操作自动继承） */
  actions: string[];
  ownerModules: string[];
  dataScopes: Record<string, DataScope>;
}

function draftOf(role: Role): Draft {
  return {
    permissions: [...role.permissions],
    actions: [...(role.actions ?? [])],
    ownerModules: [...(role.ownerModules ?? [])],
    dataScopes: { ...(role.dataScopes ?? {}) },
  };
}

const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/** 概览统计（草稿口径）：模块数 / 全量与带班模块数 / 主负责数 / 操作数 */
function summaryOf(draft: Draft) {
  const modules = draft.permissions.length;
  let all = 0;
  let managed = 0;
  for (const m of APP_MODULES) {
    if (m.scopeable !== true || !draft.permissions.includes(m.key)) continue;
    if ((draft.ownerModules.includes(m.key) ? 'all' : draft.dataScopes[m.key] ?? 'managed') === 'all') all += 1;
    else managed += 1;
  }
  const wildcards = new Set(draft.actions.filter((a) => a.endsWith(':*')).map((a) => a.slice(0, a.indexOf(':'))));
  let actions = 0;
  for (const key of wildcards) actions += ACTIONS_OF_MODULE[key]?.length ?? 0;
  actions += draft.actions.filter((a) => !a.endsWith(':*')).length;
  return { modules, all, managed, owners: draft.ownerModules.length, actions };
}

/**
 * 系统管理：按角色配置 模块—页面—操作 三级权限与数据范围（仅管理员，桌面端可编辑）。
 * 勾满一个模块的全部操作时自动存为 `module:*` 通配（后续新增操作自动继承）；
 * 收窄后按精确键存储。移动端仅提供只读权限概览。
 */
function RolePermissionsDesktop({ role, onBack }: { role: Role; onBack: () => void }) {
  const { message, modal } = App.useApp();
  const [draft, setDraft] = useState<Draft>(() => draftOf(role));
  const [saving, setSaving] = useState(false);
  const dirty = !sameDraft(draft, draftOf(role));
  const isAdminRole = role.key === 'admin';

  const patch = (updater: (prev: Draft) => Draft) => setDraft((prev) => updater(prev));

  /** 模块当前生效的操作键集合（通配 → 全部键） */
  const selectedKeysOf = (moduleKey: string): string[] => {
    if (draft.actions.includes(`${moduleKey}:*`)) return [...(ACTIONS_OF_MODULE[moduleKey] ?? [])];
    const prefix = `${moduleKey}:`;
    return draft.actions.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length));
  };

  /** 重设模块的操作键集合：勾满自动折叠为通配，收窄存精确键 */
  const setModuleKeys = (moduleKey: string, keys: string[]) => {
    const all = ACTIONS_OF_MODULE[moduleKey] ?? [];
    const isFull = all.length > 0 && all.every((k) => keys.includes(k));
    const entries = isFull ? [`${moduleKey}:*`] : keys.map((k) => `${moduleKey}:${k}`);
    patch((prev) => ({
      ...prev,
      actions: [...prev.actions.filter((a) => !a.startsWith(`${moduleKey}:`)), ...entries],
    }));
  };

  const toggleKey = (moduleKey: string, key: string) => {
    const current = selectedKeysOf(moduleKey);
    setModuleKeys(moduleKey, current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  };

  const toggleModule = (moduleKey: string, accessible: boolean) => {
    patch((prev) => {
      if (accessible) {
        // 开启模块默认放开全部操作（与升级前「可访问=全操作」口径一致）
        return {
          ...prev,
          permissions: [...prev.permissions, moduleKey],
          actions: [...prev.actions.filter((a) => !a.startsWith(`${moduleKey}:`)), `${moduleKey}:*`],
        };
      }
      return {
        ...prev,
        permissions: prev.permissions.filter((k) => k !== moduleKey),
        actions: prev.actions.filter((a) => !a.startsWith(`${moduleKey}:`)),
        ownerModules: prev.ownerModules.filter((k) => k !== moduleKey),
        dataScopes: Object.fromEntries(Object.entries(prev.dataScopes).filter(([k]) => k !== moduleKey)),
      };
    });
  };

  const toggleOwner = (moduleKey: string, owned: boolean) => {
    patch((prev) => ({
      ...prev,
      ownerModules: owned
        ? [...prev.ownerModules, moduleKey]
        : prev.ownerModules.filter((k) => k !== moduleKey),
      // 主负责模块数据范围锁定全量（解析层 owner→all，这里同步落库保持一致）
      dataScopes: owned
        ? { ...prev.dataScopes, [moduleKey]: 'all' }
        : { ...prev.dataScopes },
    }));
  };

  const setScope = (moduleKey: string, scope: DataScope) => {
    patch((prev) => ({ ...prev, dataScopes: { ...prev.dataScopes, [moduleKey]: scope } }));
  };

  const back = () => {
    if (!dirty) return onBack();
    modal.confirm({
      title: '权限配置尚未保存',
      content: '离开将丢弃未保存的修改，确定返回吗？',
      okText: '丢弃并返回',
      okButtonProps: { danger: true },
      cancelText: '继续编辑',
      onOk: onBack,
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateRole(role.id, {
        name: role.name,
        permissions: draft.permissions,
        actions: draft.actions,
        ownerModules: draft.ownerModules,
        dataScopes: draft.dataScopes,
      });
      message.success(`角色「${role.name}」权限已保存，对相关用户实时生效（无需重新登录）`);
      onBack();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const s = summaryOf(draft);
  const accessibleNow = (key: string) => draft.permissions.includes(key);

  const items: CollapseProps['items'] = MODULE_GROUPS.map((group) => ({
    key: group,
    label: <Typography.Text strong>{group}</Typography.Text>,
    children: (
      <div className="role-perm-stack">
        {APP_MODULES.filter((m) => m.group === group).map((m) => {
          const accessible = accessibleNow(m.key);
          const owned = draft.ownerModules.includes(m.key);
          const selected = selectedKeysOf(m.key);
          const allKeys = ACTIONS_OF_MODULE[m.key] ?? [];
          const scope: DataScope = owned ? 'all' : draft.dataScopes[m.key] ?? 'managed';
          const scopeable = m.scopeable === true;
          const pageAll = (keys: string[]) => keys.length > 0 && keys.every((k) => selected.includes(k));
          return (
            <div key={m.key} className="role-module-block">
              <div className="role-module-head">
                <Checkbox
                  checked={accessible}
                  disabled={isAdminRole}
                  onChange={(e) => toggleModule(m.key, e.target.checked)}
                >
                  <Typography.Text strong>可访问「{m.name}」</Typography.Text>
                </Checkbox>
                <Space size={[4, 4]} wrap>
                  {accessible && scopeable && (
                    <Tag color={scope === 'all' ? 'green' : undefined}>
                      {scope === 'all' ? '全量数据' : '仅带班数据'}
                    </Tag>
                  )}
                  {accessible && owned && <Tag color="purple">主负责</Tag>}
                  {accessible && allKeys.length > 0 && (
                    <Tag color={selected.length === allKeys.length ? 'geekblue' : 'default'}>
                      操作 {selected.length}/{allKeys.length}
                    </Tag>
                  )}
                  {accessible && allKeys.length === 0 && <Tag>只读模块</Tag>}
                </Space>
              </div>

              {accessible && (
                <div className="role-module-body">
                  {scopeable && (
                    <div className="role-scope-row">
                      <Typography.Text type="secondary" style={{ flex: '0 0 auto' }}>数据访问范围：</Typography.Text>
                      <Radio.Group
                        size="small"
                        value={scope}
                        disabled={isAdminRole || owned}
                        onChange={(e) => setScope(m.key, e.target.value as DataScope)}
                      >
                        <Radio.Button value="all">全量数据</Radio.Button>
                        <Radio.Button value="managed">仅带班数据</Radio.Button>
                      </Radio.Group>
                      {owned && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          <LockOutlined /> 主负责模块自动拥有全量数据
                        </Typography.Text>
                      )}
                      {!owned && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          （全量仅作用于查看与导出；新增/编辑/删除仍限所带班级）
                        </Typography.Text>
                      )}
                    </div>
                  )}

                  {m.ownerable !== false && (
                    <Checkbox
                      checked={owned}
                      disabled={isAdminRole}
                      onChange={(e) => toggleOwner(m.key, e.target.checked)}
                    >
                      设为「{m.name}」主负责（该模块最高权限：全院数据 + 全部管理操作）
                    </Checkbox>
                  )}

                  {m.pages.map((page) => {
                    const pageKeys = page.actions.map((a) => a.key);
                    const gatedKey = page.gated ? `page-${page.key}` : null;
                    const effectiveKeys = gatedKey ? [gatedKey, ...pageKeys] : pageKeys;
                    // 多页面模块：本组勾选只覆盖本页键，需合并其他页面的已选键再写回模块集合
                    const otherPageKeys = m.pages
                      .filter((p) => p.key !== page.key)
                      .flatMap((p) => (p.gated ? [`page-${p.key}`, ...p.actions.map((a) => a.key)] : p.actions.map((a) => a.key)))
                      .filter((k) => selected.includes(k));
                    return (
                      <div key={page.key} className="role-page-block">
                        <div className="role-page-head">
                          <Typography.Text type="secondary">{page.name}</Typography.Text>
                          {effectiveKeys.length > 0 && (
                            <Space size={0}>
                              <Button
                                size="small"
                                type="link"
                                disabled={isAdminRole || pageAll(effectiveKeys)}
                                onClick={() => setModuleKeys(m.key, [...new Set([...selected, ...effectiveKeys])])}
                              >
                                全选
                              </Button>
                              <Button
                                size="small"
                                type="link"
                                disabled={isAdminRole || selected.length === 0}
                                onClick={() => setModuleKeys(m.key, selected.filter((k) => !effectiveKeys.includes(k)))}
                              >
                                清空
                              </Button>
                            </Space>
                          )}
                        </div>
                        {effectiveKeys.length > 0 ? (
                          <Checkbox.Group
                            value={selected}
                            disabled={isAdminRole}
                            onChange={(next) => setModuleKeys(m.key, [...new Set([...otherPageKeys, ...(next as string[])])])}
                          >
                            <Space size={[14, 8]} wrap>
                              {gatedKey && (
                                <Checkbox value={gatedKey}>访问{page.name}</Checkbox>
                              )}
                              {page.actions.map((a) => (
                                <Checkbox key={a.key} value={a.key}>{a.name}</Checkbox>
                              ))}
                            </Space>
                          </Checkbox.Group>
                        ) : (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {m.key === 'mentalHealth'
                              ? '关注标记 / 导入关注 / 导出访谈等管理操作随「主负责」开放，不做逐操作勾选。'
                              : '本页面无独立操作（访问即使用）。'}
                          </Typography.Text>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    ),
  }));

  const defaultActive = MODULE_GROUPS.filter((g) =>
    APP_MODULES.some((m) => m.group === g && accessibleNow(m.key)),
  );

  return (
    <div className="page">
      <PageHeader
        title={`权限配置 · ${role.name}`}
        subtitle="按 模块—页面—操作 调整访问与操作权限、数据访问范围；保存后对相关用户实时生效（无需重新登录）"
        onBack={back}
        extra={
          isAdminRole ? (
            <Button icon={<ArrowLeftOutlined />} onClick={back}>返回列表</Button>
          ) : (
            <Space>
              <Button onClick={back}>取消</Button>
              <Button onClick={() => setDraft(draftOf(role))} disabled={!dirty}>重置</Button>
              <Button type="primary" loading={saving} disabled={!dirty} onClick={save}>保存</Button>
            </Space>
          )
        }
      />

      {isAdminRole ? (
        <Alert
          type="info"
          showIcon
          message="内置「系统管理员」始终拥有全部模块、全部操作与全量数据权限，不可调整。"
        />
      ) : role.disabled ? (
        <Alert
          type="warning"
          showIcon
          message="该角色处于停用状态：保存的配置不会生效，启用后按此配置恢复授权。"
        />
      ) : null}

      <Descriptions
        size="small"
        bordered
        column={{ xs: 1, sm: 2, md: 4 }}
        items={[
          { key: 'key', label: '角色标识', children: <Typography.Text code>{role.key}</Typography.Text> },
          {
            key: 'status',
            label: '状态',
            children: <Tag color={role.disabled ? 'default' : 'blue'}>{role.disabled ? '已停用' : '启用'}</Tag>,
          },
          { key: 'users', label: '用户数', children: role.userCount > 0 ? `${role.userCount} 人` : '—' },
          { key: 'desc', label: '说明', children: role.description || '—' },
          { key: 'overview', label: '权限概览', children: (
            <Space size={[4, 4]} wrap>
              <Tag color="blue">{s.modules} 个模块</Tag>
              {s.all > 0 && <Tag color="green">全量 {s.all}</Tag>}
              {s.managed > 0 && <Tag>带班 {s.managed}</Tag>}
              {s.owners > 0 && <Tag color="purple">主负责 {s.owners}</Tag>}
              <Tag color={s.actions > 0 ? 'geekblue' : 'default'}>
                {s.actions > 0 ? `操作 ${s.actions} 项` : '只读'}
              </Tag>
            </Space>
          ) },
        ]}
      />

      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '4px 0' }}>
        勾满一个模块的全部操作会存为通配（后续版本新增操作自动继承）；未勾选任何操作即为只读角色。
      </Typography.Text>

      <Collapse
        items={items}
        defaultActiveKey={defaultActive}
      />
    </div>
  );
}

/** 移动端：只读权限概览（编辑请使用桌面端） */
function RolePermissionsMobile({ role, onBack }: { role: Role; onBack: () => void }) {
  const draft = draftOf(role);
  const s = summaryOf(draft);
  return (
    <div className="page">
      <PageHeader
        title={`权限概览 · ${role.name}`}
        subtitle="移动端仅提供只读概览，权限调整请在桌面端「配置权限」页操作"
        onBack={onBack}
      />
      {role.key === 'admin' ? (
        <Alert type="info" showIcon message="内置「系统管理员」拥有全部模块、全部操作与全量数据。" />
      ) : (
        <>
          <Descriptions
            size="small"
            bordered
            column={1}
            items={[
              { key: 'key', label: '角色标识', children: <Typography.Text code>{role.key}</Typography.Text> },
              {
                key: 'status',
                label: '状态',
                children: <Tag color={role.disabled ? 'default' : 'blue'}>{role.disabled ? '已停用' : '启用'}</Tag>,
              },
              { key: 'users', label: '用户数', children: role.userCount > 0 ? `${role.userCount} 人` : '—' },
              { key: 'desc', label: '说明', children: role.description || '—' },
            ]}
          />
          <div style={{ margin: '12px 0' }}>
            <Space size={[4, 4]} wrap>
              <Tag color="blue">{s.modules} 个模块</Tag>
              {s.all > 0 && <Tag color="green">全量 {s.all}</Tag>}
              {s.managed > 0 && <Tag>带班 {s.managed}</Tag>}
              {s.owners > 0 && <Tag color="purple">主负责 {s.owners}</Tag>}
              <Tag color={s.actions > 0 ? 'geekblue' : 'default'}>
                {s.actions > 0 ? `操作 ${s.actions} 项` : '只读'}
              </Tag>
            </Space>
          </div>
          {APP_MODULES.filter((m) => draft.permissions.includes(m.key)).map((m) => {
            const owned = draft.ownerModules.includes(m.key);
            const scope = owned ? 'all' : draft.dataScopes[m.key] ?? 'managed';
            const wildcard = draft.actions.includes(`${m.key}:*`);
            const count = wildcard
              ? ACTIONS_OF_MODULE[m.key]?.length ?? 0
              : draft.actions.filter((a) => a.startsWith(`${m.key}:`)).length;
            return (
              <div key={m.key} className="role-module-block" style={{ padding: '8px 12px' }}>
                <Space size={[6, 6]} wrap>
                  <Typography.Text strong>{m.name}</Typography.Text>
                  {m.scopeable === true && (
                    <Tag color={scope === 'all' ? 'green' : undefined}>
                      {scope === 'all' ? '全量数据' : '仅带班'}
                    </Tag>
                  )}
                  {owned && <Tag color="purple">主负责</Tag>}
                  {(ACTIONS_OF_MODULE[m.key]?.length ?? 0) > 0 && (
                    <Tag color={wildcard || count > 0 ? 'geekblue' : 'default'}>
                      {wildcard ? '全部操作' : count > 0 ? `操作 ${count} 项` : '只读'}
                    </Tag>
                  )}
                </Space>
              </div>
            );
          })}
          {draft.permissions.length === 0 && (
            <Alert type="warning" showIcon message="该角色尚未分配任何模块权限。" />
          )}
        </>
      )}
    </div>
  );
}

export default function RolePermissionsPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { id } = useParams();
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const roles = await getRoles();
        const found = roles.find((r) => String(r.id) === String(id));
        if (cancelled) return;
        if (!found) {
          message.error('角色不存在或已被删除');
          navigate('/admin/roles', { replace: true });
          return;
        }
        setRole(found);
      } catch (e) {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : '角色加载失败');
          navigate('/admin/roles', { replace: true });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onBack = useMemo(() => () => navigate('/admin/roles'), []);

  if (loading) return <div className="page" style={{ padding: 48 }}><Spin /></div>;
  if (!role) return null;

  return isMobile
    ? <RolePermissionsMobile role={role} onBack={onBack} />
    : <RolePermissionsDesktop role={role} onBack={onBack} />;
}
