import {
  DownloadOutlined,
  InboxOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';

import { createUser, deleteUser, getUsers, importUsers, updateUser } from '@/api/admin';
import type { ManagedUser } from '@/api/admin';
import { getClassOptions } from '@/api/classes';
import { getRoleOptions } from '@/api/roles';
import PageHeader from '@/components/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getStoredUser } from '@/lib/auth';
import type {
  ClassOption,
  ParsedUserRow,
  RoleOption,
  UserImportFailure,
  UserImportResult,
} from '@/types';
import {
  IMPORT_PASSWORD_PREFIX,
  downloadUserTemplate,
  exportUserImportFailures,
  parseUserExcel,
  validateUserRows,
} from '@/utils/userImport';
import AdminUsersMobile from './mobile';

interface UserFormValues {
  username: string;
  displayName: string;
  /** 角色集合（多选；有效模块权限取各角色并集） */
  roleKeys: string[];
  password?: string;
  classIds?: number[];
}

interface EditFormValues {
  displayName: string;
  /** 角色集合（多选；不能修改自己的角色） */
  roleKeys: string[];
}

interface ParsedImport {
  fileName: string;
  totalRows: number;
  valid: ParsedUserRow[];
  failures: UserImportFailure[];
}

/**
 * 系统管理：账号开设、编辑角色、分配班级、停用启用、重置密码、单条删除与 Excel 批量导入（仅管理员）。
 * 角色下拉来自「角色管理」，改角色即改该用户的可访问模块（服务端每次请求按角色实时解析）。
 */
function AdminUsersDesktop() {
  const isMobile = useIsMobile();
  const { message, modal } = App.useApp();
  const currentUser = getStoredUser();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<UserFormValues>();
  const roleKeysWatch = Form.useWatch('roleKeys', form);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetForm] = Form.useForm<{ password: string }>();

  /* ---------- 编辑账号（姓名 / 角色） ---------- */
  const [editTarget, setEditTarget] = useState<ManagedUser | null>(null);
  const [editForm] = Form.useForm<EditFormValues>();

  /* ---------- 辅导员分班 ---------- */
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [assignTarget, setAssignTarget] = useState<ManagedUser | null>(null);
  const [assignForm] = Form.useForm<{ classIds?: number[] }>();
  const [assigning, setAssigning] = useState(false);

  /* ---------- 批量导入 ---------- */
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [importResult, setImportResult] = useState<UserImportResult | null>(null);
  const [importDone, setImportDone] = useState(false);

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

  /** 角色展示名：优先服务端 JOIN 出的 roleName，其次角色字典，最后回退标识 */
  const roleNameOf = (user: ManagedUser) =>
    user.roleName ?? roleOptions.find((r) => r.key === user.role)?.name ?? user.role;

  /** 启用状态的管理员数量：用于「至少保留一名管理员」的前端护栏 */
  const enabledAdminCount = useMemo(
    () => users.filter((u) => u.role === 'admin' && !u.disabled).length,
    [users],
  );

  /** 班级选项按年级分组（Select OptGroup 展示） */
  const gradeGroups = useMemo(() => {
    const groups: { gradeName: string; items: ClassOption[] }[] = [];
    const index = new Map<string, number>();
    for (const opt of classOptions) {
      let gi = index.get(opt.gradeName);
      if (gi === undefined) {
        gi = groups.length;
        index.set(opt.gradeName, gi);
        groups.push({ gradeName: opt.gradeName, items: [] });
      }
      groups[gi].items.push(opt);
    }
    return groups;
  }, [classOptions]);

  /** 按年级分组的班级多选（新增账号与分配班级共用） */
  const classSelect = (
    <Select
      mode="multiple"
      allowClear
      showSearch
      optionFilterProp="children"
      placeholder="选择所辖班级（可多选）"
    >
      {gradeGroups.map((g) => (
        <Select.OptGroup key={g.gradeName} label={g.gradeName}>
          {g.items.map((c) => (
            <Select.Option key={c.id} value={c.id}>
              {c.name}
            </Select.Option>
          ))}
        </Select.OptGroup>
      ))}
    </Select>
  );

  const openAssign = (user: ManagedUser) => {
    setAssignTarget(user);
    assignForm.setFieldsValue({ classIds: user.classIds ?? [] });
  };

  const handleAssign = async () => {
    if (!assignTarget) return;
    let values: { classIds?: number[] };
    try {
      values = await assignForm.validateFields();
    } catch {
      return;
    }
    setAssigning(true);
    try {
      await updateUser(assignTarget.id, { classIds: values.classIds ?? [] });
      message.success(`已更新「${assignTarget.displayName}」的所辖班级`);
      setAssignTarget(null);
      void reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setAssigning(false);
    }
  };

  const handleCreate = async () => {
    let values: UserFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      // 角色集合含 admin 时不分配班级（管理员全量权限，带班无意义）
      const isAdminSelected = values.roleKeys.includes('admin');
      await createUser({
        username: values.username,
        displayName: values.displayName,
        roleKeys: values.roleKeys,
        password: values.password ?? '',
        classIds: isAdminSelected ? undefined : values.classIds,
      });
      message.success(`账号「${values.username}」已创建`);
      setFormOpen(false);
      form.resetFields();
      void reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- 编辑 ---------- */

  const openEdit = (user: ManagedUser) => {
    setEditTarget(user);
    editForm.setFieldsValue({
      displayName: user.displayName,
      roleKeys: user.roleKeys?.length ? user.roleKeys : [user.role],
    });
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    let values: EditFormValues;
    try {
      values = await editForm.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      await updateUser(editTarget.id, { displayName: values.displayName, roleKeys: values.roleKeys });
      const names = values.roleKeys
        .map((k) => roleOptions.find((r) => r.key === k)?.name ?? k)
        .join('、');
      message.success(`「${values.displayName}」已保存（角色：${names}），权限即时生效`);
      setEditTarget(null);
      void reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- 停用 / 启用 ---------- */

  const toggleDisabled = (user: ManagedUser) => {
    const next = !user.disabled;
    modal.confirm({
      title: next ? `停用账号「${user.displayName}」？` : `启用账号「${user.displayName}」？`,
      content: next ? '停用后该教师将无法登录系统。' : '启用后恢复登录权限。',
      okText: next ? '停用' : '启用',
      okButtonProps: next ? { danger: true } : undefined,
      cancelText: '取消',
      onOk: async () => {
        try {
          await updateUser(user.id, { disabled: next });
          message.success(next ? '账号已停用' : '账号已启用');
          void reload();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '操作失败');
        }
      },
    });
  };

  /* ---------- 重置密码 ---------- */

  const handleResetPassword = async () => {
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

  /* ---------- 删除（单条） ---------- */

  /** 删除护栏：不能删自己；管理员账号需保证系统至少留一名启用管理员 */
  const deleteBlockReason = (user: ManagedUser): string | null => {
    if (user.id === currentUser?.id) return '不能删除当前登录的账号';
    if (user.role === 'admin' && enabledAdminCount <= 1) return '系统至少需要保留一名启用管理员';
    return null;
  };

  const handleDelete = (user: ManagedUser) => {
    const blocked = deleteBlockReason(user);
    if (blocked) {
      message.warning(blocked);
      return;
    }
    modal.confirm({
      title: `删除账号「${user.displayName}」？`,
      width: 480,
      content: (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <div>用户名：{user.username}</div>
          <div>角色：{roleNameOf(user)}</div>
          <div>
            所辖班级：
            {user.role === 'admin' ? '—' : user.classNames?.length ? user.classNames.join('、') : '未分配'}
          </div>
          <Typography.Text type="danger">
            删除后该账号立即失效，其带班与共管关系一并解除，且无法恢复。
          </Typography.Text>
        </Space>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteUser(user.id);
          message.success(`账号「${user.username}」已删除`);
          void reload();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败');
        }
      },
    });
  };

  /* ---------- 批量导入 ---------- */

  const openImport = () => {
    setParsed(null);
    setImportResult(null);
    setImportDone(false);
    setImportOpen(true);
  };

  const resetImport = () => {
    setParsed(null);
    setImportResult(null);
    setImportDone(false);
  };

  const closeImport = () => {
    setImportOpen(false);
    if (importResult && importResult.successCount > 0) void reload();
  };

  /** 解析并校验 Excel（本地预检；正式导入时服务端会按库内数据二次查重） */
  const handleImportFile = async (file: File) => {
    try {
      const rows = await parseUserExcel(file);
      if (rows.length === 0) {
        message.warning('未解析到数据行，请检查文件内容');
        return;
      }
      const { valid, failures } = validateUserRows(rows, {
        usernames: new Set(users.map((u) => u.username)),
        roles: roleOptions.length > 0 ? roleOptions : undefined,
        classes: classOptions.length > 0 ? classOptions : undefined,
      });
      setParsed({ fileName: file.name, totalRows: rows.length, valid, failures });
      if (valid.length === 0) {
        message.warning('没有可导入的数据行，请根据失败原因修正后重新上传');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '文件解析失败，请使用标准模板填写');
    }
  };

  const confirmImport = async () => {
    if (!parsed || parsed.valid.length === 0) return;
    setImporting(true);
    try {
      const result = await importUsers(parsed.valid);
      setImportResult(result);
      setImportDone(true);
      message.success(`成功导入 ${result.successCount} 个账号`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  /** 预检失败 + 服务端二次校验驳回的记录，合并展示 / 导出 */
  const allFailures: UserImportFailure[] = parsed
    ? [...parsed.failures, ...(importResult?.failures ?? [])]
    : [];

  /* ---------- 表格 ---------- */

  const columns: ColumnsType<ManagedUser> = [
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '姓名', dataIndex: 'displayName', width: 100 },
    {
      title: '角色',
      dataIndex: 'roleName',
      width: 150,
      render: (_, record) => {
        // 多角色：roleKeys 与 roleNames 一一对应；旧数据无 roleKeys 时回退主角色
        const keys = record.roleKeys?.length ? record.roleKeys : [record.role];
        const names = record.roleNames?.length ? record.roleNames : keys;
        return (
          <Space size={4} wrap>
            {keys.map((key, i) => (
              <Tag
                key={key}
                color={key === 'admin' ? 'gold' : key === 'counselor' ? 'blue' : 'purple'}
                style={{ marginInlineEnd: 0 }}
              >
                {names[i] ?? key}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '所辖班级',
      dataIndex: 'classNames',
      width: 200,
      ellipsis: true,
      render: (_, record) =>
        record.role === 'admin'
          ? '—'
          : record.classNames?.length
            ? record.classNames.join('、')
            : <Typography.Text type="secondary">未分配</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'disabled',
      width: 80,
      render: (disabled: boolean) =>
        disabled ? <Tag color="red">已停用</Tag> : <Tag color="green">正常</Tag>,
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 150 },
    {
      title: '操作',
      key: 'action',
      width: 344,
      fixed: 'right',
      render: (_, record) => {
        const blockReason = deleteBlockReason(record);
        return (
          <Space size={2} wrap={false}>
            <Button type="link" size="small" onClick={() => openEdit(record)}>
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              disabled={record.role === 'admin'}
              onClick={() => openAssign(record)}
            >
              分配班级
            </Button>
            <Button
              type="link"
              size="small"
              onClick={() => {
                setResetTarget(record);
                resetForm.resetFields();
              }}
            >
              重置密码
            </Button>
            <Button
              type="link"
              size="small"
              disabled={record.role === 'admin'}
              onClick={() => toggleDisabled(record)}
            >
              {record.disabled ? '启用' : '停用'}
            </Button>
            {blockReason ? (
              <Tooltip title={blockReason}>
                <Button type="link" size="small" danger disabled>
                  删除
                </Button>
              </Tooltip>
            ) : (
              <Button type="link" size="small" danger onClick={() => handleDelete(record)}>
                删除
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  /** 新增账号的默认角色：首个非管理员角色（内置「辅导员」，改过名也不受影响的 key） */
  const defaultRole =
    roleOptions.find((r) => r.key !== 'admin')?.key ?? roleOptions[0]?.key ?? 'counselor';

  return (
    <div className="page">
      <PageHeader
        title="用户管理"
        subtitle="开设账号、分配角色与班级、删除账号；辅导员/班主任请在「班级管理」录入工号（未匹配的待同步人员可在「班级管理 → 同步用户管理」一键建号，初始密码自动生成为「Hzpt@工号」，首次登录需修改）"
        extra={
          <Space wrap>
            <Button icon={<UploadOutlined />} onClick={openImport}>
              批量导入
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({ roleKeys: [defaultRole] });
                setFormOpen(true);
              }}
            >
              新增账号
            </Button>
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="角色决定可访问模块：支持为账号绑定多个角色，有效权限取各角色权限的并集；「角色管理」中调整权限后对相关用户实时生效（无需重新登录）。"
      />

      <Table
        rowKey="id"
        columns={columns}
        dataSource={users}
        loading={loading}
        scroll={{ x: 1114 }}
        pagination={false}
        rowClassName={(record) => (record.disabled ? 'row-disabled' : '')}
      />

      {/* 新增账号 */}
      <Modal
        title="新增账号"
        open={formOpen}
        confirmLoading={submitting}
        onOk={handleCreate}
        onCancel={() => setFormOpen(false)}
        okText="创建"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 24px)' : 460}
      >
        <Form form={form} layout="vertical">
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
          <Form.Item name="displayName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="如 张三" />
          </Form.Item>
          <Form.Item
            name="roleKeys"
            label="角色（可多选）"
            rules={[{ required: true, message: '请至少选择一个角色' }]}
            extra="多选时有效模块权限取各角色的并集（最高权限）"
          >
            <Select
              mode="multiple"
              placeholder="选择角色"
              options={roleOptions.map((r) => ({ value: r.key, label: r.name }))}
            />
          </Form.Item>
          {!(roleKeysWatch ?? []).includes('admin') && (
            <Form.Item name="classIds" label="所辖班级" extra="可多选；也可创建后在列表中调整">
              {classSelect}
            </Form.Item>
          )}
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
        </Form>
      </Modal>

      {/* 编辑账号：姓名 + 角色（角色决定可访问模块） */}
      <Modal
        title={`编辑账号 · ${editTarget?.username ?? ''}`}
        open={!!editTarget}
        confirmLoading={submitting}
        onOk={handleEdit}
        onCancel={() => setEditTarget(null)}
        okText="保存"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 24px)' : 460}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="displayName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="如 张三" />
          </Form.Item>
          <Form.Item
            name="roleKeys"
            label="角色（可多选）"
            rules={[{ required: true, message: '请至少选择一个角色' }]}
            extra={
              editTarget?.id === currentUser?.id
                ? '不能修改自己的角色（避免误操作导致失去管理入口）'
                : '多选时有效模块权限取各角色的并集；含「系统管理员」会清空其带班关系。调整后立即生效，无需重新登录'
            }
          >
            <Select
              mode="multiple"
              disabled={editTarget?.id === currentUser?.id}
              options={roleOptions.map((r) => ({ value: r.key, label: r.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 分配班级 */}
      <Modal
        title={`分配班级 · ${assignTarget?.displayName ?? ''}`}
        open={!!assignTarget}
        confirmLoading={assigning}
        onOk={handleAssign}
        onCancel={() => setAssignTarget(null)}
        okText="保存"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 24px)' : 460}
      >
        <Form form={assignForm} layout="vertical">
          <Form.Item
            name="classIds"
            label="所辖班级"
            extra="该教师负责的班级，可多选；按年级分组展示。带班范围决定其可见的敏感记录（谈话/预警/审批）"
          >
            {classSelect}
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码 */}
      <Modal
        title={`重置密码 · ${resetTarget?.displayName ?? ''}`}
        open={!!resetTarget}
        confirmLoading={submitting}
        onOk={handleResetPassword}
        onCancel={() => setResetTarget(null)}
        okText="重置"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 24px)' : 420}
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

      {/* 批量导入账号：下载模板 → 上传 → 校验/结果 */}
      <Modal
        title="批量导入账号"
        width={isMobile ? 'calc(100vw - 24px)' : 780}
        open={importOpen}
        onCancel={closeImport}
        footer={
          importDone
            ? [
                <Button key="again" onClick={resetImport}>
                  再次导入
                </Button>,
                <Button key="close" type="primary" onClick={closeImport}>
                  完成
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={closeImport}>
                  取消
                </Button>,
                <Button
                  key="ok"
                  type="primary"
                  loading={importing}
                  disabled={!parsed || parsed.valid.length === 0}
                  onClick={confirmImport}
                >
                  {parsed ? `确认导入 ${parsed.valid.length} 条` : '确认导入'}
                </Button>,
              ]
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="import-step">
            <div className="import-step-title">① 下载并填写模板</div>
            <Space wrap>
              <Button
                icon={<DownloadOutlined />}
                onClick={() => downloadUserTemplate(roleOptions.map((r) => r.name))}
              >
                下载 Excel 模板
              </Button>
              <Typography.Text type="secondary">
                模板含示例行与「填写说明」工作表，角色列可填角色名称
              </Typography.Text>
            </Space>
            <ul className="import-rules">
              <li>文件格式：.xlsx / .xls；读取「用户名单」工作表，首行列标题不可修改或增删</li>
              <li>必填字段：用户名（3-20 位字母/数字/下划线，全局唯一）、姓名（1-20 字）、角色（角色名称或标识）</li>
              <li>选填字段：所辖班级（多个用「、」分隔；同名班级写成「2024级·计应2401」）</li>
              <li>
                <Typography.Text strong>辅导员 / 班主任请在「班级管理」录入工号（未匹配的待同步人员可在「同步用户管理」一键建号）</Typography.Text>
                ：教师数据（账号、角色、带班）以班级管理为唯一来源，本通道不再受理这两类角色，
                填写后该行会被拒绝并提示
              </li>
              <li>
                初始密码由系统自动生成，规则为「{IMPORT_PASSWORD_PREFIX}用户名」（如 zhangsan → {IMPORT_PASSWORD_PREFIX}zhangsan），无需在模板中填写，首次登录需修改
              </li>
              <li>校验规则：用户名与系统内或本表内重复、角色不存在或为教师类角色、班级未匹配字典的行将被拒绝，不影响其他行写入</li>
              <li>导入方式：追加写入、整批事务提交；管理员角色忽略「所辖班级」列</li>
            </ul>
          </div>

          {!importDone && (
            <div className="import-step">
              <div className="import-step-title">② 上传填写好的 Excel</div>
              <Upload.Dragger
                accept=".xlsx,.xls"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  void handleImportFile(file);
                  return false; // 阻止自动上传，改为前端解析校验
                }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
                <p className="ant-upload-hint">支持 .xlsx / .xls；先校验后导入，可预览失败明细</p>
              </Upload.Dragger>
            </div>
          )}

          {parsed && (
            <div className="import-step">
              <div className="import-step-title">{importDone ? '③ 导入结果' : '③ 校验结果'}</div>
              <Alert
                showIcon
                type={allFailures.length > 0 ? 'warning' : 'success'}
                message={
                  importDone
                    ? `成功导入 ${importResult?.successCount ?? 0} 个账号，初始密码已按「${IMPORT_PASSWORD_PREFIX}用户名」自动生成（如 zhangsan → ${IMPORT_PASSWORD_PREFIX}zhangsan），首次登录需修改。`
                    : `文件「${parsed.fileName}」共解析 ${parsed.totalRows} 行：可导入 ${parsed.valid.length} 条，${parsed.failures.length} 条存在问题。`
                }
                description={
                  importDone
                    ? allFailures.length > 0
                      ? '部分数据未通过服务端校验未导入，可导出失败明细修正后重新上传。'
                      : '全部数据均导入成功。'
                    : allFailures.length > 0
                      ? '导入采用追加方式，仅写入通过校验的行；可导出失败明细修正后重新上传。'
                      : undefined
                }
              />
              {allFailures.length > 0 && (
                <>
                  <Table
                    size="small"
                    rowKey="row"
                    style={{ marginTop: 12 }}
                    columns={[
                      { title: 'Excel 行号', dataIndex: 'row', width: 90 },
                      { title: '用户名', dataIndex: 'username', width: 130 },
                      { title: '姓名', dataIndex: 'displayName', width: 100 },
                      { title: '失败原因', dataIndex: 'reason' },
                    ]}
                    dataSource={allFailures}
                    pagination={false}
                    scroll={{ y: 180 }}
                  />
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    style={{ marginTop: 12 }}
                    onClick={() => exportUserImportFailures(allFailures)}
                  >
                    导出失败明细
                  </Button>
                </>
              )}
            </div>
          )}
        </Space>
      </Modal>
    </div>
  );
}

/**
 * 视口分发：≤768px 走移动端独立渲染层（账号卡片化，修复桌面表格在手机上
 * 「固定操作列占满屏幕、看不到是谁的账号」的问题）；桌面端零改动。
 */
export default function AdminUsers() {
  const isMobile = useIsMobile();
  return isMobile ? <AdminUsersMobile /> : <AdminUsersDesktop />;
}
