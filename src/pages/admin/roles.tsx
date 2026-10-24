import { KeyOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createRole, deleteRole, getRoles, updateRole } from '@/api/roles';
import PageHeader from '@/components/PageHeader';
import { ACTIONS_OF_MODULE, APP_MODULES } from '@/constants/modules';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { Role } from '@/types';
import AdminRolesMobile from './rolesMobile';

interface RoleFormValues {
  name: string;
  key?: string;
  description?: string;
  disabled?: boolean;
}

/** 角色操作权限统计：通配模块按注册表全部操作计（显示「全部」口径） */
function actionCountOf(role: Role): number {
  const wildcards = new Set(
    role.actions.filter((a) => a.endsWith(':*')).map((a) => a.slice(0, a.indexOf(':'))),
  );
  let count = 0;
  for (const key of wildcards) count += ACTIONS_OF_MODULE[key]?.length ?? 0;
  count += role.actions.filter((a) => !a.endsWith(':*')).length;
  return count;
}

/** 权限概览摘要：模块数 + 数据范围 + 操作数（admin 特判全部） */
export function permissionSummary(role: Role): { modules: number; all: number; managed: number; actions: number } {
  const modules = role.permissions.includes('*') ? APP_MODULES.length : role.permissions.length;
  const scopeable = APP_MODULES.filter((m) => m.scopeable === true && role.permissions.includes(m.key));
  const all = scopeable.filter((m) => (role.dataScopes?.[m.key] ?? 'managed') === 'all').length;
  return { modules, all, managed: scopeable.length - all, actions: actionCountOf(role) };
}

/** 系统管理：角色维护（桌面端，仅管理员）；权限配置在 /admin/roles/:id/permissions 独立页面 */
function AdminRolesDesktop() {
  const isMobile = useIsMobile();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<RoleFormValues>();

  const reload = async () => {
    setLoading(true);
    try {
      setRoles(await getRoles());
    } catch (e) {
      message.error(e instanceof Error ? e.message : '角色加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ disabled: false });
    setFormOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    form.setFieldsValue({
      name: role.name,
      key: role.key,
      description: role.description,
      disabled: !!role.disabled,
    });
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    let values: RoleFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await updateRole(editing.id, values);
        message.success(`角色「${values.name}」已更新，权限实时生效`);
        setFormOpen(false);
      } else {
        const created = await createRole({ ...values, key: values.key?.trim() || undefined });
        setFormOpen(false);
        modal.confirm({
          title: `角色「${values.name}」已创建`,
          content: '新角色尚未配置任何模块权限，是否立即进入权限配置？',
          okText: '去配置权限',
          cancelText: '稍后',
          onOk: () => navigate(`/admin/roles/${created.id}/permissions`),
        });
      }
      void reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (role: Role) => {
    try {
      await deleteRole(role.id);
      message.success(`角色「${role.name}」已删除`);
      void reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  /** 启用/停用：停用即时收回该角色授予的全部权限（服务端每请求实时解析，无需重新登录） */
  const toggleDisabled = (role: Role) => {
    const nextDisabled = !role.disabled;
    modal.confirm({
      title: nextDisabled ? `停用角色「${role.name}」？` : `启用角色「${role.name}」？`,
      content: nextDisabled
        ? role.userCount > 0
          ? `该角色下有 ${role.userCount} 名用户，停用后这些用户将从下一次请求起失去该角色授予的全部权限（不会删除分配关系，重新启用即恢复）。`
          : '停用后该角色不再授予任何权限；重新启用即恢复。'
        : '启用后该角色授予的权限立即恢复生效。',
      okText: nextDisabled ? '停用' : '启用',
      okButtonProps: nextDisabled ? { danger: true } : undefined,
      cancelText: '取消',
      onOk: async () => {
        try {
          await updateRole(role.id, { disabled: nextDisabled });
          message.success(`角色「${role.name}」已${nextDisabled ? '停用' : '启用'}，实时生效`);
          void reload();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '操作失败');
        }
      },
    });
  };

  /** 权限概览列：模块数 + 数据范围 + 操作数摘要（admin 显示全部） */
  const overviewTag = (role: Role) => {
    if (role.permissions.includes('*')) {
      return <Tag color="gold">全部模块 · 全部操作 · 全量数据</Tag>;
    }
    if (role.permissions.length === 0) {
      return <Typography.Text type="secondary">未分配模块</Typography.Text>;
    }
    const s = permissionSummary(role);
    return (
      <Space size={[4, 4]} wrap>
        <Tag color="blue">{s.modules} 个模块</Tag>
        {s.all > 0 && <Tag color="green">全量 {s.all}</Tag>}
        {s.managed > 0 && <Tag>带班 {s.managed}</Tag>}
        {role.ownerModules.length > 0 && (
          <Tag color="purple">主负责 {role.ownerModules.length}</Tag>
        )}
        <Tag color={s.actions > 0 ? 'geekblue' : 'default'}>
          {s.actions > 0 ? `操作 ${s.actions} 项` : '只读'}
        </Tag>
      </Space>
    );
  };

  const columns: ColumnsType<Role> = [
    {
      title: '角色名称',
      dataIndex: 'name',
      width: 150,
      render: (name: string, record) => (
        <Space size={6}>
          <span style={{ fontWeight: 600 }}>{name}</span>
          {record.isSystem && <Tag color={record.key === 'admin' ? 'gold' : 'default'}>内置</Tag>}
        </Space>
      ),
    },
    {
      title: '角色标识',
      dataIndex: 'key',
      width: 150,
      render: (key: string) => (
        <Typography.Text code style={{ fontSize: 12 }}>{key}</Typography.Text>
      ),
    },
    {
      title: '说明',
      dataIndex: 'description',
      width: 180,
      ellipsis: true,
      render: (v?: string) => v || '—',
    },
    {
      title: '状态',
      dataIndex: 'disabled',
      width: 86,
      render: (disabled?: boolean) => (
        <Tag color={disabled ? 'default' : 'blue'}>{disabled ? '已停用' : '启用'}</Tag>
      ),
    },
    {
      title: '权限概览',
      dataIndex: 'permissions',
      width: 330,
      render: (_, record) => overviewTag(record),
    },
    {
      title: '用户数',
      dataIndex: 'userCount',
      width: 80,
      render: (count: number) => (count > 0 ? `${count} 人` : '—'),
    },
    { title: '更新时间', dataIndex: 'updatedAt', width: 150 },
    {
      title: '操作',
      key: 'action',
      width: 250,
      fixed: 'right',
      render: (_, record) => {
        const locked = record.key === 'admin';
        return (
          <Space size={4} wrap={false}>
            <Button
              type="link"
              size="small"
              icon={<SafetyCertificateOutlined />}
              onClick={() => navigate(`/admin/roles/${record.id}/permissions`)}
            >
              配置权限
            </Button>
            <Button type="link" size="small" disabled={locked} onClick={() => openEdit(record)}>
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              disabled={locked}
              onClick={() => toggleDisabled(record)}
            >
              {record.disabled ? '启用' : '停用'}
            </Button>
            <Popconfirm
              title={`删除角色「${record.name}」？`}
              description={
                record.isSystem
                  ? '内置角色不可删除'
                  : record.userCount > 0
                    ? `该角色下仍有 ${record.userCount} 名用户，需先调整用户角色`
                    : '删除后不可恢复'
              }
              disabled={record.isSystem || record.userCount > 0}
              onConfirm={() => handleDelete(record)}
              okText="删除"
              cancelText="取消"
            >
              <Button
                type="link"
                size="small"
                danger
                disabled={record.isSystem || record.userCount > 0}
              >
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="角色管理"
        subtitle="维护角色与基础信息；在「配置权限」中按 模块—页面—操作 调整权限与数据范围，实时生效（无需重新登录）"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增角色
          </Button>
        }
      />

      <Alert
        type="info"
        showIcon
        message="内置「系统管理员」始终拥有全部权限且不可修改或停用；用户/角色/日志/数据管理等系统管理模块仅系统管理员可访问。停用角色会即时收回其授予的全部权限，但不删除用户的角色分配。"
      />

      <Table
        rowKey="id"
        columns={columns}
        dataSource={roles}
        loading={loading}
        scroll={{ x: 1240 }}
        pagination={false}
        rowClassName={(record) => (record.disabled ? 'row-disabled' : '')}
      />

      <Modal
        title={editing ? `编辑角色 · ${editing.name}` : '新增角色'}
        open={formOpen}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setFormOpen(false)}
        okText="保存"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 24px)' : 520}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="角色名称"
            rules={[
              { required: true, message: '请输入角色名称' },
              { max: 20, message: '不可超过 20 个字' },
            ]}
          >
            <Input placeholder="如 院系负责人 / 资助专员" />
          </Form.Item>
          <Form.Item
            name="key"
            label={
              <Space size={4}>
                <KeyOutlined />
                角色标识
              </Space>
            }
            extra={editing
              ? '标识创建后不可修改（用户的角色分配按标识引用）。'
              : '2-30 位小写字母/数字/下划线，字母开头；留空自动生成。创建后不可修改。'}
            rules={[
              { pattern: /^[a-z][a-z0-9_]{1,29}$/, message: '2-30 位小写字母、数字或下划线，且以字母开头' },
            ]}
          >
            <Input placeholder="如 gradeDirector（选填）" disabled={!!editing} />
          </Form.Item>
          <Form.Item
            name="description"
            label="角色说明"
            rules={[{ max: 100, message: '不可超过 100 个字' }]}
          >
            <Input.TextArea rows={2} placeholder="该角色的职责范围（选填）" />
          </Form.Item>
          <Form.Item name="disabled" label="状态" valuePropName="checked" initialValue={false}>
            <Switch
              checkedChildren="启用"
              unCheckedChildren="停用"
              disabled={editing?.key === 'admin'}
            />
          </Form.Item>
          <Typography.Text type="secondary">
            模块访问、操作权限与数据范围请在保存后进入「配置权限」页调整；
            停用的角色不授予任何权限，重新启用即恢复。
          </Typography.Text>
        </Form>
      </Modal>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        权限口径与侧边菜单、服务端接口校验共用同一份模块注册表，修改后立即生效。
      </Typography.Text>
    </div>
  );
}

/**
 * 视口分发：≤768px 走移动端独立渲染层（角色卡片化 + 基础信息表单 + 只读权限概览），
 * 桌面端零改动。
 */
export default function AdminRoles() {
  const isMobile = useIsMobile();
  return isMobile ? <AdminRolesMobile /> : <AdminRolesDesktop />;
}
