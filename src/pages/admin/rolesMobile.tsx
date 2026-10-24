import { Popconfirm } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createRole, deleteRole, getRoles, updateRole } from '@/api/roles';
import FilterSheet from '@/components/mobile/FilterSheet';
import { MIcon } from '@/components/mobile/icons';
import { ACTIONS_OF_MODULE, APP_MODULES } from '@/constants/modules';
import type { Role } from '@/types';

interface RoleDraft {
  name: string;
  key: string;
  description: string;
  disabled: boolean;
}

const emptyDraft = (): RoleDraft => ({ name: '', key: '', description: '', disabled: false });

/** 权限概览摘要（与桌面同口径）：模块数 / 全量 / 带班 / 主负责 / 操作数 */
function summaryOf(r: Role) {
  if (r.permissions.includes('*')) return { adminWide: true, modules: APP_MODULES.length, all: 0, managed: 0, owners: 0, actions: 0 };
  const scopeable = APP_MODULES.filter((m) => m.scopeable === true && r.permissions.includes(m.key));
  const all = scopeable.filter((m) => (r.ownerModules.includes(m.key) ? 'all' : r.dataScopes?.[m.key] ?? 'managed') === 'all').length;
  const wildcards = new Set((r.actions ?? []).filter((a) => a.endsWith(':*')).map((a) => a.slice(0, a.indexOf(':'))));
  let actions = 0;
  for (const key of wildcards) actions += ACTIONS_OF_MODULE[key]?.length ?? 0;
  actions += (r.actions ?? []).filter((a) => !a.endsWith(':*')).length;
  return { adminWide: false, modules: r.permissions.length, all, managed: scopeable.length - all, owners: r.ownerModules.length, actions };
}

/**
 * 移动端角色管理：角色卡片化（名称/标识/状态/权限概览/用户数），
 * 表单仅维护基础信息（名称/标识/说明/状态），权限调整引导至桌面端「配置权限」页；
 * 移动端可查看只读权限概览。护栏与桌面完全同口径：
 * admin 内置角色不可编辑/停用；内置角色或仍有用户的角色不可删除。
 */
export default function AdminRolesMobile() {
  const navigate = useNavigate();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const [sheet, setSheet] = useState<{ open: boolean; mode: 'create' | 'edit'; role: Role | null }>({
    open: false,
    mode: 'create',
    role: null,
  });
  const [draft, setDraft] = useState<RoleDraft>(emptyDraft);
  const [errors, setErrors] = useState<{ name?: string; key?: string }>({});
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

  const openCreate = () => {
    setSheet({ open: true, mode: 'create', role: null });
    setDraft(emptyDraft());
    setErrors({});
  };

  const openEdit = (role: Role) => {
    setSheet({ open: true, mode: 'edit', role });
    setDraft({
      name: role.name,
      key: role.key,
      description: role.description ?? '',
      disabled: !!role.disabled,
    });
    setErrors({});
  };

  const closeSheet = () => {
    if (saving) return; // 保存过程中禁止误触关闭
    setSheet({ open: false, mode: 'create', role: null });
  };

  const submit = async () => {
    const errs: { name?: string; key?: string } = {};
    const name = draft.name.trim();
    if (!name || name.length > 20) errs.name = '角色名称需为 1-20 个字';
    const key = draft.key.trim();
    if (key && !/^[a-z][a-z0-9_]{1,29}$/.test(key)) errs.key = '2-30 位小写字母/数字/下划线，字母开头';
    if (errs.name || errs.key) {
      setErrors(errs);
      return;
    }
    setSaving(true);
    try {
      if (sheet.mode === 'edit' && sheet.role) {
        await updateRole(sheet.role.id, {
          name,
          description: draft.description.trim() || undefined,
          disabled: draft.disabled,
        });
        showToast(`角色「${name}」已更新，实时生效`);
      } else {
        await createRole({
          name,
          key: key || undefined,
          description: draft.description.trim() || undefined,
        });
        showToast(`角色「${name}」已创建，请在桌面端配置权限`);
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

  /** 启用/停用：与桌面同口径，停用即时收回授权（无需重新登录） */
  const toggleDisabled = async (role: Role) => {
    try {
      await updateRole(role.id, { disabled: !role.disabled });
      showToast(`角色「${role.name}」已${role.disabled ? '启用' : '停用'}，实时生效`);
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败');
    }
  };

  return (
    <>
      {/* 说明卡（桌面端为 Alert，语义同 info） */}
      <div className="m-card" style={{ background: 'var(--info-bg)', borderColor: 'var(--info-bd)', color: 'var(--info-fg)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <MIcon name="shield" size={16} style={{ flex: '0 0 auto', marginTop: 2 }} />
          <span className="m-t4" style={{ lineHeight: 1.7 }}>
            内置「系统管理员」始终拥有全部权限且不可修改；移动端可查看角色权限概览，
            模块—页面—操作权限与数据范围的调整请在桌面端「配置权限」页完成。
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
          const s = summaryOf(r);
          const locked = r.key === 'admin';
          const canEdit = !locked;
          const canDelete = !r.isSystem && r.userCount === 0;
          return (
            <div className="m-card" key={r.id} style={r.disabled ? { opacity: 0.62 } : undefined}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="m-ava">
                  <MIcon name="shield" size={16} />
                </span>
                <div className="m-row-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-t1">{r.name}</span>
                    {r.isSystem && <span className="m-tag warning">内置</span>}
                    <span className={`m-tag ${r.disabled ? 'neutral' : 'success'}`}>
                      {r.disabled ? '已停用' : '启用'}
                    </span>
                  </div>
                  <div className="m-t4" style={{ marginTop: 2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {r.key}
                  </div>
                </div>
              </div>

              {r.description && <div className="m-t4" style={{ marginTop: 8 }}>{r.description}</div>}

              {/* 权限概览标签：模块数/数据范围/主负责/操作数 */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {s.adminWide ? (
                  <span className="m-tag warning">全部模块 · 全部操作 · 全量数据</span>
                ) : (
                  <>
                    <span className="m-tag neutral">{s.modules} 个模块</span>
                    {s.all > 0 && <span className="m-tag success">全量 {s.all}</span>}
                    {s.managed > 0 && <span className="m-tag neutral">带班 {s.managed}</span>}
                    {s.owners > 0 && <span className="m-tag info">主负责 {s.owners}</span>}
                    <span className="m-tag neutral">{s.actions > 0 ? `操作 ${s.actions} 项` : '只读'}</span>
                  </>
                )}
              </div>

              <div className="m-t4" style={{ marginTop: 8 }}>
                {r.userCount > 0 ? `${r.userCount} 名用户` : '暂无用户'} · 更新于 {r.updatedAt.slice(0, 10)}
              </div>

              {/* 卡片操作行（护栏同桌面：admin 不可编辑/停用；内置/有用户不可删除） */}
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  marginTop: 6,
                  borderTop: '1px solid var(--m-border)',
                  paddingTop: 4,
                }}
              >
                <a className="m-act" onClick={() => navigate(`/admin/roles/${r.id}/permissions`)} aria-label={`查看角色 ${r.name} 权限概览`}>
                  <MIcon name="check" size={18} />
                  权限概览
                </a>
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
                  title={r.disabled ? `启用角色「${r.name}」？` : `停用角色「${r.name}」？`}
                  description={r.disabled
                    ? '启用后该角色授予的权限立即恢复生效。'
                    : r.userCount > 0
                      ? `该角色下有 ${r.userCount} 名用户，停用后将从下一次请求起失去该角色授予的全部权限。`
                      : '停用后该角色不再授予任何权限。'}
                  disabled={locked}
                  onConfirm={() => void toggleDisabled(r)}
                >
                  <a
                    className="m-act"
                    style={locked ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
                    aria-label={`${r.disabled ? '启用' : '停用'}角色 ${r.name}`}
                  >
                    <MIcon name="shield" size={18} />
                    {r.disabled ? '启用' : '停用'}
                  </a>
                </Popconfirm>
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

      {/* 新增 / 编辑角色：基础信息（权限配置在桌面端完成） */}
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
          <label>角色标识（选填，创建后不可修改）</label>
          <input
            className="m-inp"
            value={draft.key}
            maxLength={30}
            placeholder="如 gradeDirector，留空自动生成"
            disabled={sheet.mode === 'edit'}
            style={sheet.mode === 'edit' ? { opacity: 0.62 } : undefined}
            onChange={(e) => {
              setDraft({ ...draft, key: e.target.value });
              if (errors.key) setErrors({ ...errors, key: '' });
            }}
          />
          <div className="m-form-err">
            {errors.key && (
              <>
                <MIcon name="alertCircle" size={13} />
                {errors.key}
              </>
            )}
          </div>
          {sheet.mode === 'edit' && (
            <div className="m-t4" style={{ marginTop: 4 }}>标识创建后不可修改（用户的角色分配按标识引用）。</div>
          )}
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

        {sheet.mode === 'edit' && (
          <div className="m-field">
            <label>状态</label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label className="m-cbx-row">
                <input
                  type="radio"
                  className="m-cbx"
                  checked={!draft.disabled}
                  onChange={() => setDraft({ ...draft, disabled: false })}
                />
                <span className="m-box" />
                <span className="m-t3">启用</span>
              </label>
              <label className="m-cbx-row">
                <input
                  type="radio"
                  className="m-cbx"
                  checked={draft.disabled}
                  onChange={() => setDraft({ ...draft, disabled: true })}
                />
                <span className="m-box" />
                <span className="m-t3">停用（不授予任何权限）</span>
              </label>
            </div>
          </div>
        )}

        <div className="m-t4" style={{ lineHeight: 1.7, marginTop: 8 }}>
          模块访问、操作权限与数据范围请在桌面端「角色管理 → 配置权限」页调整；
          保存后对相关用户实时生效（无需重新登录）。
        </div>
      </FilterSheet>

      {toast && <div className="m-toast success">{toast}</div>}
    </>
  );
}
