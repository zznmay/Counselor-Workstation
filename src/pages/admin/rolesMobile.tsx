import { App, Popconfirm } from 'antd';
import { useEffect, useMemo, useState } from 'react';

import { createRole, deleteRole, getRoles, updateRole } from '@/api/roles';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import { APP_MODULES, MODULE_GROUPS } from '@/constants/modules';
import type { Role } from '@/types';

interface RoleDraft {
  name: string;
  description: string;
  permissions: string[];
  ownerModules: string[];
}

const emptyDraft = (): RoleDraft => ({ name: '', description: '', permissions: [], ownerModules: [] });

/** 复选行：m-cbx 隐藏原生框 + m-box 视觉框 + 文字，整行点击可切换 */
function CbxRow(props: { label: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="m-cbx-row" style={props.disabled ? { opacity: 0.45, pointerEvents: 'none' } : undefined}>
      <input
        type="checkbox"
        className="m-cbx"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="m-box">
        <svg className="m-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span className="m-t3" style={{ flex: 1, minWidth: 0 }}>{props.label}</span>
    </label>
  );
}

/**
 * 移动端角色管理：角色卡片化（名称/标识/说明/权限标签/用户数），
 * 表单走全屏 FilterSheet（原生输入 + 分组复选行），护栏与桌面完全同口径：
 * admin 内置角色不可编辑；内置角色或仍有用户的角色不可删除。
 */
export default function AdminRolesMobile() {
  const { message } = App.useApp();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const [sheet, setSheet] = useState<{ open: boolean; mode: 'create' | 'edit'; role: Role | null }>({
    open: false,
    mode: 'create',
    role: null,
  });
  const [draft, setDraft] = useState<RoleDraft>(emptyDraft);
  const [errors, setErrors] = useState<{ name?: string; permissions?: string }>({});
  const [saving, setSaving] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2600);
  };

  const reload = async () => {
    setLoading(true);
    try {
      setRoles(await getRoles());
    } catch (e) {
      showToast(e instanceof Error ? e.message : '角色加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupedModules = useMemo(
    () =>
      MODULE_GROUPS.map((group) => ({
        group,
        items: APP_MODULES.filter((m) => m.group === group),
      })).filter((g) => g.items.length > 0),
    [],
  );

  /** 主负责模块仅展示 ownerable 模块；功能级权限（如心理访谈）不参与主负责配置 */
  const groupedOwnerModules = useMemo(
    () =>
      MODULE_GROUPS.map((group) => ({
        group,
        items: APP_MODULES.filter((m) => m.group === group && m.ownerable !== false),
      })).filter((g) => g.items.length > 0),
    [],
  );

  const openCreate = () => {
    setSheet({ open: true, mode: 'create', role: null });
    setDraft(emptyDraft());
    setErrors({});
  };

  const openEdit = (role: Role) => {
    setSheet({ open: true, mode: 'edit', role });
    setDraft({
      name: role.name,
      description: role.description ?? '',
      permissions: role.permissions.includes('*') ? [] : [...role.permissions],
      ownerModules: [...(role.ownerModules ?? [])],
    });
    setErrors({});
  };

  const closeSheet = () => {
    if (saving) return; // 保存过程中禁止误触关闭
    setSheet({ open: false, mode: 'create', role: null });
  };

  /** 勾选/取消可访问模块：取消时同步收回其主负责（与后端子集校验/静默 prune 同口径） */
  const togglePerm = (key: string, next: boolean) => {
    setDraft((d) => {
      const permissions = next ? [...d.permissions, key] : d.permissions.filter((k) => k !== key);
      const ownerModules = next ? d.ownerModules : d.ownerModules.filter((k) => k !== key);
      return { ...d, permissions, ownerModules };
    });
    if (errors.permissions) setErrors({ ...errors, permissions: '' });
  };

  const submit = async () => {
    const errs: { name?: string; permissions?: string } = {};
    if (!draft.name.trim()) errs.name = '请输入角色名称';
    if (draft.permissions.length === 0) errs.permissions = '请至少勾选一个可访问模块';
    if (errs.name || errs.permissions) {
      setErrors(errs);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        permissions: draft.permissions,
        ownerModules: draft.ownerModules,
      };
      if (sheet.mode === 'edit' && sheet.role) {
        await updateRole(sheet.role.id, payload);
        showToast(`角色「${payload.name}」已更新，权限已实时生效`);
      } else {
        await createRole(payload);
        showToast(`角色「${payload.name}」已创建`);
      }
      setSheet({ open: false, mode: 'create', role: null });
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role: Role) => {
    try {
      await deleteRole(role.id);
      showToast(`角色「${role.name}」已删除`);
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除失败');
    }
  };

  return (
    <>
      {/* 说明卡（桌面端为 Alert，语义同 info） */}
      <div className="m-card" style={{ background: 'var(--info-bg)', borderColor: 'var(--info-bd)', color: 'var(--info-fg)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <MIcon name="shield" size={16} style={{ flex: '0 0 auto', marginTop: 2 }} />
          <span className="m-t4" style={{ lineHeight: 1.7 }}>
            内置「系统管理员」始终拥有全部权限且不可修改；可为角色按模块指定「主负责辅导员」（该模块最高权限）；
            用户与角色/日志等系统管理模块仅管理员可访问。
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span className="m-t4" style={{ flex: 1, minWidth: 0 }}>
          共 {roles.length} 个角色 · 权限调整实时生效
        </span>
        <button type="button" className="m-btn m-btn-primary" onClick={openCreate}>
          <MIcon name="plus" size={14} />
          新增角色
        </button>
      </div>

      {roles.length === 0 && !loading ? (
        <div className="m-card empty">
          <MIcon name="shield" size={22} />
          <div className="m-t3" style={{ marginTop: 6 }}>暂无角色</div>
        </div>
      ) : (
        roles.map((r) => {
          const owners = r.ownerModules ?? [];
          const canEdit = r.key !== 'admin';
          const canDelete = !r.isSystem && r.userCount === 0;
          return (
            <div className="m-card" key={r.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="m-ava">
                  <MIcon name="shield" size={16} />
                </span>
                <div className="m-row-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-t1">{r.name}</span>
                    {r.isSystem && <span className="m-tag warning">内置</span>}
                  </div>
                  <div className="m-t4" style={{ marginTop: 2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {r.key}
                  </div>
                </div>
              </div>

              {r.description && <div className="m-t4" style={{ marginTop: 8 }}>{r.description}</div>}

              {/* 权限标签：可访问=neutral，主负责=info（信息层级与桌面 蓝色/紫色 同构） */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {r.permissions.includes('*') ? (
                  <span className="m-tag warning">全部模块</span>
                ) : r.permissions.length === 0 ? (
                  <span className="m-t4">未分配模块</span>
                ) : (
                  <>
                    {APP_MODULES.filter((m) => r.permissions.includes(m.key)).map((m) => (
                      <span key={m.key} className="m-tag neutral">{m.name}</span>
                    ))}
                    {owners.map((key) => {
                      const m = APP_MODULES.find((x) => x.key === key);
                      return m ? (
                        <span key={`owner-${key}`} className="m-tag info">
                          <MIcon name="check" size={12} />
                          {m.name}·主负责
                        </span>
                      ) : null;
                    })}
                  </>
                )}
              </div>

              <div className="m-t4" style={{ marginTop: 8 }}>
                {r.userCount > 0 ? `${r.userCount} 名用户` : '暂无用户'} · 更新于 {r.updatedAt.slice(0, 10)}
              </div>

              {/* 卡片操作行（护栏同桌面：admin 不可编辑；内置/有用户不可删除） */}
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  marginTop: 6,
                  borderTop: '1px solid var(--m-border)',
                  paddingTop: 4,
                }}
              >
                <a
                  className="m-act"
                  style={canEdit ? undefined : { opacity: 0.4, pointerEvents: 'none' }}
                  onClick={() => openEdit(r)}
                  aria-label={`编辑角色 ${r.name}${canEdit ? '' : '（系统管理员不可编辑）'}`}
                >
                  <MIcon name="edit" size={18} />
                  编辑
                </a>
                <Popconfirm
                  title={`删除角色「${r.name}」？`}
                  description={
                    r.isSystem
                      ? '内置角色不可删除'
                      : r.userCount > 0
                        ? `该角色下仍有 ${r.userCount} 名用户，需先调整用户角色`
                        : '删除后不可恢复'
                  }
                  disabled={!canDelete}
                  onConfirm={() => void handleDelete(r)}
                >
                  <a
                    className="m-act danger"
                    style={canDelete ? undefined : { opacity: 0.4, pointerEvents: 'none' }}
                    aria-label={`删除角色 ${r.name}${canDelete ? '' : '（不可删除）'}`}
                  >
                    <MIcon name="trash" size={18} />
                    删除
                  </a>
                </Popconfirm>
              </div>
            </div>
          );
        })
      )}

      {loading && (
        <div className="m-loadmore">
          <MIcon name="spinner" size={16} className="m-spin" />
          加载中…
        </div>
      )}

      {/* 新增 / 编辑角色：全屏长表单，防误触关闭 */}
      <FilterSheet
        open={sheet.open}
        title={sheet.mode === 'edit' ? `编辑角色 · ${sheet.role?.name ?? ''}` : '新增角色'}
        fullscreen
        dismissible={false}
        onClose={closeSheet}
        footer={
          <>
            <button type="button" className="m-btn m-btn-ghost" disabled={saving} onClick={closeSheet}>
              取消
            </button>
            <button type="button" className="m-btn m-btn-primary" disabled={saving} onClick={submit}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="m-field">
          <label>
            角色名称
            <span className="m-req">*</span>
          </label>
          <input
            className="m-inp"
            value={draft.name}
            maxLength={20}
            placeholder="如 院系负责人 / 资助专员"
            onChange={(e) => {
              setDraft({ ...draft, name: e.target.value });
              if (errors.name) setErrors({ ...errors, name: '' });
            }}
          />
          <div className="m-form-err">
            {errors.name && (
              <>
                <MIcon name="alertCircle" size={13} />
                {errors.name}
              </>
            )}
          </div>
        </div>

        <div className="m-field">
          <label>角色说明（选填）</label>
          <textarea
            className="m-inp"
            rows={2}
            maxLength={100}
            placeholder="该角色的职责范围"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>

        <div className="m-field">
          <label>
            可访问模块
            <span className="m-req">*</span>
          </label>
          <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
            <a
              className="m-t4"
              style={{ color: 'var(--info-fg)' }}
              onClick={() => {
                setDraft((d) => ({ ...d, permissions: APP_MODULES.map((m) => m.key) }));
                setErrors((e) => ({ ...e, permissions: '' }));
              }}
            >
              全选
            </a>
            <a className="m-t4" style={{ color: 'var(--m-text-2)' }} onClick={() => setDraft((d) => ({ ...d, permissions: [], ownerModules: [] }))}>
              清空
            </a>
          </div>
          {groupedModules.map(({ group, items }) => (
            <div key={group} style={{ marginBottom: 6 }}>
              <div className="m-group-title">{group}</div>
              {items.map((m) => (
                <CbxRow
                  key={m.key}
                  label={m.name}
                  checked={draft.permissions.includes(m.key)}
                  onChange={(next) => togglePerm(m.key, next)}
                />
              ))}
            </div>
          ))}
          <div className="m-form-err">
            {errors.permissions && (
              <>
                <MIcon name="alertCircle" size={13} />
                {errors.permissions}
              </>
            )}
          </div>
        </div>

        <div className="m-field">
          <label>主负责模块（该模块最高权限，选填）</label>
          {groupedOwnerModules.map(({ group, items }) => (
            <div key={group} style={{ marginBottom: 6 }}>
              <div className="m-group-title">{group}</div>
              {items.map((m) => (
                <CbxRow
                  key={m.key}
                  label={m.name}
                  checked={draft.ownerModules.includes(m.key)}
                  disabled={!draft.permissions.includes(m.key)}
                  onChange={(next) =>
                    setDraft((d) => ({
                      ...d,
                      ownerModules: next ? [...d.ownerModules, m.key] : d.ownerModules.filter((k) => k !== m.key),
                    }))
                  }
                />
              ))}
            </div>
          ))}
          <div className="m-t4" style={{ marginTop: 6, lineHeight: 1.7 }}>
            主负责角色在该模块可查看全院学生数据并执行全部操作，须先勾选对应「可访问模块」；「心理访谈」为功能级权限（不承载菜单），入口在心理健康页。
          </div>
        </div>
      </FilterSheet>

      {toast && <div className="m-toast success">{toast}</div>}
    </>
  );
}
