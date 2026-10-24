import { App, Form, Input, Modal, Popconfirm, Select } from 'antd';
import { useEffect, useMemo, useState } from 'react';

import { createUser, deleteUser, getUsers, updateUser } from '@/api/admin';
import type { ManagedUser } from '@/api/admin';
import { getClassOptions } from '@/api/classes';
import { getRoleOptions } from '@/api/roles';
import { MIcon } from '@/components/mobile/icons';
import ClassMultiSelect from '@/components/ClassMultiSelect';
import { getStoredUser } from '@/lib/auth';
import type { ClassOption, RoleOption } from '@/types';

/**
 * 移动端用户管理：账号卡片化（头像 + 姓名 + 用户名 + 角色/状态标签 + 班级），
 * 操作收敛为卡片底部 m-act 行；表单沿用 antd Modal（与 classes/mobile 同一先例）。
 * 修复桌面表格在手机上「固定操作列占满屏幕、看不到是谁的账号」的问题。
 * 护栏与桌面同口径：不能删/改自己、不能停用管理员、至少保留一名启用管理员。
 */
export default function AdminUsersMobile() {
  const { message } = App.useApp();
  const currentUser = getStoredUser();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [search, setSearch] = useState('');

  /* ---------- 表单弹窗 ---------- */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [form] = Form.useForm<{ username: string; displayName: string; roleKeys: string[]; password?: string; classIds?: number[] }>();
  const roleKeysWatch = Form.useWatch('roleKeys', form);
  const [assignTarget, setAssignTarget] = useState<ManagedUser | null>(null);
  const [assignForm] = Form.useForm<{ classIds?: number[] }>();
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetForm] = Form.useForm<{ password: string }>();
  const [submitting, setSubmitting] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      setUsers(await getUsers());
    } catch (e) {
      message.error(e instanceof Error ? e.message : '用户列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    getRoleOptions().then(setRoleOptions).catch(() => undefined);
    getClassOptions().then(setClassOptions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 角色下拉选项：停用角色标注「已停用」且不可新选（存量已分配的仍展示） */
  const roleSelectOptions = useMemo(
    () => roleOptions.map((r) => ({
      value: r.key,
      label: r.disabled ? `${r.name}（已停用）` : r.name,
      disabled: !!r.disabled,
    })),
    [roleOptions],
  );

  const enabledAdminCount = useMemo(
    () => users.filter((u) => u.role === 'admin' && !u.disabled).length,
    [users],
  );

  /** 删除护栏：不能删自己；管理员账号需保证至少留一名启用管理员 */
  const canDelete = (u: ManagedUser) =>
    u.id !== currentUser?.id && !(u.role === 'admin' && enabledAdminCount <= 1);

  /** 班级多选（新增/分配共用） */
  const classSelect = <ClassMultiSelect classOptions={classOptions} />;

  /* ---------- 搜索（本地过滤：姓名 / 用户名 / 角色名） ---------- */
  const visibleUsers = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(kw)
        || u.username.toLowerCase().includes(kw)
        || (u.roleName ?? '').toLowerCase().includes(kw),
    );
  }, [users, search]);

  /* ---------- 动作 ---------- */
  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ roleKeys: [roleOptions.find((r) => r.key !== 'admin')?.key ?? roleOptions[0]?.key] });
    setFormOpen(true);
  };

  const openEdit = (u: ManagedUser) => {
    setEditing(u);
    form.resetFields();
    form.setFieldsValue({ displayName: u.displayName, roleKeys: u.roleKeys?.length ? u.roleKeys : [u.role] });
    setFormOpen(true);
  };

  const handleFormSubmit = async () => {
    let values: { username: string; displayName: string; roleKeys: string[]; password?: string; classIds?: number[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await updateUser(editing.id, { displayName: values.displayName, roleKeys: values.roleKeys });
        const names = values.roleKeys
          .map((k) => roleOptions.find((r) => r.key === k)?.name ?? k)
          .join('、');
        message.success(`「${values.displayName}」已保存（角色：${names}），权限即时生效`);
      } else {
        // 角色集合含 admin 时不分配班级
        const isAdminSelected = values.roleKeys.includes('admin');
        await createUser({
          username: values.username,
          displayName: values.displayName,
          roleKeys: values.roleKeys,
          password: values.password ?? '',
          classIds: isAdminSelected ? undefined : values.classIds,
        });
        message.success(`账号「${values.username}」已创建`);
      }
      setFormOpen(false);
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssign = async () => {
    if (!assignTarget) return;
    let values: { classIds?: number[] };
    try {
      values = await assignForm.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      await updateUser(assignTarget.id, { classIds: values.classIds ?? [] });
      message.success(`已更新「${assignTarget.displayName}」的所辖班级`);
      setAssignTarget(null);
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    let values: { password: string };
    try {
      values = await resetForm.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      await updateUser(resetTarget.id, { password: values.password });
      message.success(`已重置「${resetTarget.displayName}」的密码，下次登录需修改`);
      setResetTarget(null);
      resetForm.resetFields();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '重置失败');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDisabled = async (u: ManagedUser) => {
    const next = !u.disabled;
    try {
      await updateUser(u.id, { disabled: next });
      message.success(next ? '账号已停用' : '账号已启用');
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const handleDelete = async (u: ManagedUser) => {
    try {
      await deleteUser(u.id);
      message.success(`账号「${u.username}」已删除`);
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  return (
    <>
      <div className="m-t4" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>共 {users.length} 个账号</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="m-btn m-btn-soft" onClick={openCreate}>
          <MIcon name="plus" size={14} />
          新增账号
        </button>
      </div>

      <div className="m-search-row">
        <div className="m-search-field">
          <input
            className="m-inp"
            value={search}
            placeholder="搜索姓名 / 用户名 / 角色"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {search && (
          <button type="button" className="m-btn m-btn-ghost" onClick={() => setSearch('')}>
            清空
          </button>
        )}
      </div>

      {visibleUsers.length === 0 && !loading ? (
        <div className="m-card empty">
          <MIcon name="search" size={22} />
          <div className="m-t3" style={{ marginTop: 6 }}>
            {users.length === 0 ? '暂无账号' : '没有符合条件的账号'}
          </div>
        </div>
      ) : (
        visibleUsers.map((u) => {
          const isSelf = u.id === currentUser?.id;
          return (
            <div className="m-card" key={u.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="m-ava">{u.displayName.slice(0, 1)}</span>
                <div className="m-row-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-t1">{u.displayName}</span>
                    {(u.roleKeys?.length ? u.roleKeys : [u.role]).map((key, i) => {
                      const names = u.roleNames?.length ? u.roleNames : u.roleKeys ?? [u.role];
                      return (
                        <span key={key} className={`m-tag ${key === 'admin' ? 'warning' : 'info'}`}>
                          {names[i] ?? key}
                        </span>
                      );
                    })}
                    {u.disabled && <span className="m-tag danger">已停用</span>}
                    {isSelf && <span className="m-tag neutral">当前登录</span>}
                  </div>
                  <div className="m-t3" style={{ marginTop: 3 }}>
                    @{u.username} · 创建于 {u.createdAt?.slice(0, 10)}
                  </div>
                </div>
              </div>

              <div className="m-t4" style={{ marginTop: 6 }}>
                {u.role === 'admin'
                  ? '系统管理员，拥有全部模块权限'
                  : `所辖班级：${u.classNames?.length ? u.classNames.join('、') : '未分配'}`}
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  marginTop: 6,
                  borderTop: '1px solid var(--m-border)',
                  paddingTop: 4,
                }}
              >
                <a className="m-act" onClick={() => openEdit(u)} aria-label={`编辑 ${u.displayName}`}>
                  <MIcon name="edit" size={18} />
                  编辑
                </a>
                {u.role !== 'admin' && (
                  <a
                    className="m-act"
                    onClick={() => {
                      setAssignTarget(u);
                      assignForm.setFieldsValue({ classIds: u.classIds ?? [] });
                    }}
                    aria-label={`分配班级 ${u.displayName}`}
                  >
                    <MIcon name="school" size={18} />
                    分配班级
                  </a>
                )}
                <a
                  className="m-act"
                  onClick={() => {
                    setResetTarget(u);
                    resetForm.resetFields();
                  }}
                  aria-label={`重置密码 ${u.displayName}`}
                >
                  <MIcon name="shield" size={18} />
                  重置密码
                </a>
                {u.role !== 'admin' && (
                  <Popconfirm
                    title={u.disabled ? `启用「${u.displayName}」？` : `停用「${u.displayName}」？`}
                    description={u.disabled ? '启用后恢复登录权限。' : '停用后该教师将无法登录系统。'}
                    okText={u.disabled ? '启用' : '停用'}
                    cancelText="取消"
                    onConfirm={() => void toggleDisabled(u)}
                  >
                    <a className="m-act" onClick={(e) => e.stopPropagation()} aria-label={`${u.disabled ? '启用' : '停用'} ${u.displayName}`}>
                      <MIcon name={u.disabled ? 'check' : 'x'} size={18} />
                      {u.disabled ? '启用' : '停用'}
                    </a>
                  </Popconfirm>
                )}
                {canDelete(u) ? (
                  <Popconfirm
                    title={`删除账号「${u.displayName}」？`}
                    description="删除后该账号立即失效，其带班与共管关系一并解除，且无法恢复。"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={() => void handleDelete(u)}
                  >
                    <a className="m-act danger" onClick={(e) => e.stopPropagation()} aria-label={`删除 ${u.displayName}`}>
                      <MIcon name="trash" size={18} />
                      删除
                    </a>
                  </Popconfirm>
                ) : (
                  <span className="m-act" style={{ opacity: 0.45, cursor: 'not-allowed' }} aria-disabled>
                    <MIcon name="trash" size={18} />
                    {isSelf ? '当前账号' : '不可删除'}
                  </span>
                )}
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

      {/* 新增 / 编辑账号 */}
      <Modal
        title={editing ? `编辑账号 · ${editing.username}` : '新增账号'}
        open={formOpen}
        width="calc(100vw - 24px)"
        confirmLoading={submitting}
        onOk={handleFormSubmit}
        onCancel={() => setFormOpen(false)}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <Form.Item
              name="username"
              label="用户名"
              rules={[
                { required: true, message: '请输入用户名' },
                { pattern: /^[a-zA-Z0-9_]{3,20}$/, message: '3-20 位字母/数字/下划线' },
              ]}
            >
              <Input placeholder="如 zhangsan" />
            </Form.Item>
          )}
          <Form.Item name="displayName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="如 张三" maxLength={20} />
          </Form.Item>
          <Form.Item
            name="roleKeys"
            label="角色（可多选）"
            rules={[{ required: true, message: '请至少选择一个角色' }]}
            extra={
              editing?.id === currentUser?.id
                ? '不能修改自己的角色'
                : '多选时有效模块权限取各角色的并集'
            }
          >
            <Select
              mode="multiple"
              disabled={editing?.id === currentUser?.id}
              placeholder="选择角色"
              options={roleSelectOptions}
            />
          </Form.Item>
          {!editing && !(roleKeysWatch ?? []).includes('admin') && (
            <Form.Item name="classIds" label="所辖班级" extra="可多选；也可创建后调整">
              {classSelect}
            </Form.Item>
          )}
          {!editing && (
            <Form.Item
              name="password"
              label="初始密码"
              rules={[
                { required: true, message: '请输入初始密码' },
                { min: 8, message: '至少 8 位' },
                { pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/, message: '需同时包含字母和数字' },
              ]}
              extra="首次登录时系统会要求该教师修改密码"
            >
              <Input.Password placeholder="至少 8 位，含字母和数字" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* 分配班级 */}
      <Modal
        title={`分配班级 · ${assignTarget?.displayName ?? ''}`}
        open={!!assignTarget}
        width="calc(100vw - 24px)"
        confirmLoading={submitting}
        onOk={handleAssign}
        onCancel={() => setAssignTarget(null)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={assignForm} layout="vertical">
          <Form.Item
            name="classIds"
            label="所辖班级"
            extra="该教师负责的班级，可多选；带班范围决定其可见的敏感记录"
          >
            {classSelect}
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码 */}
      <Modal
        title={`重置密码 · ${resetTarget?.displayName ?? ''}`}
        open={!!resetTarget}
        width="calc(100vw - 24px)"
        confirmLoading={submitting}
        onOk={handleReset}
        onCancel={() => setResetTarget(null)}
        okText="重置"
        cancelText="取消"
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '至少 8 位' },
              { pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/, message: '需同时包含字母和数字' },
            ]}
            extra="重置后该教师首次登录需修改密码"
          >
            <Input.Password placeholder="至少 8 位，含字母和数字" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
