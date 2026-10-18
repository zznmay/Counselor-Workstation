import { PlusOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';

import { createRole, deleteRole, getRoles, updateRole } from '@/api/roles';
import PageHeader from '@/components/PageHeader';
import { APP_MODULES, MODULE_GROUPS } from '@/constants/modules';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { Role } from '@/types';

interface RoleFormValues {
  name: string;
  description?: string;
  permissions: string[];
  ownerModules: string[];
}

/** 系统管理：角色维护与模块权限配置（仅管理员） */
export default function AdminRoles() {
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<RoleFormValues>();
  /** 已勾选的可访问模块（主负责 Checkbox 的禁用依据） */
  const perms = Form.useWatch('permissions', form) ?? [];

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
    form.setFieldsValue({ permissions: [], ownerModules: [] });
    setFormOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    form.setFieldsValue({
      name: role.name,
      description: role.description,
      permissions: role.permissions.includes('*') ? [] : role.permissions,
      ownerModules: role.ownerModules ?? [],
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
        message.success(`角色「${values.name}」已更新，权限已实时生效`);
      } else {
        await createRole(values);
        message.success(`角色「${values.name}」已创建`);
      }
      setFormOpen(false);
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

  /** 权限标签：admin 显示全部；普通角色展示模块名 + 紫色「主负责」标识 */
  const permissionTags = (role: Role) => {
    if (role.permissions.includes('*')) return <Tag color="gold">全部模块</Tag>;
    if (role.permissions.length === 0) return <Typography.Text type="secondary">未分配模块</Typography.Text>;
    const owners = role.ownerModules ?? [];
    return (
      <Space size={[4, 4]} wrap>
        {APP_MODULES.filter((m) => role.permissions.includes(m.key)).map((m) => (
          <Tag key={m.key} color="blue">{m.name}</Tag>
        ))}
        {owners.map((key) => {
          const m = APP_MODULES.find((x) => x.key === key);
          return m ? <Tag key={`owner-${key}`} color="purple">{m.name}·主负责</Tag> : null;
        })}
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
      width: 155,
      render: (key: string) => (
        <Typography.Text code style={{ fontSize: 12 }}>{key}</Typography.Text>
      ),
    },
    {
      title: '说明',
      dataIndex: 'description',
      width: 200,
      ellipsis: true,
      render: (v?: string) => v || '—',
    },
    {
      title: '可访问模块',
      dataIndex: 'permissions',
      width: 340,
      render: (_, record) => permissionTags(record),
    },
    {
      title: '用户数',
      dataIndex: 'userCount',
      width: 80,
      render: (count: number) => (count > 0 ? `${count} 人` : '—'),
    },
    { title: '更新时间', dataIndex: 'updatedAt', width: 155 },
    {
      title: '操作',
      key: 'action',
      width: 110,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4} wrap={false}>
          <Button
            type="link"
            size="small"
            disabled={record.key === 'admin'}
            onClick={() => openEdit(record)}
          >
            编辑
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
      ),
    },
  ];

  const groupedModules = useMemo(
    () => MODULE_GROUPS.map((group) => ({
      group,
      items: APP_MODULES.filter((m) => m.group === group),
    })).filter((g) => g.items.length > 0),
    [],
  );

  /** 主负责模块仅展示 ownerable 模块；功能级权限（如心理访谈）不参与主负责配置 */
  const groupedOwnerModules = useMemo(
    () => MODULE_GROUPS.map((group) => ({
      group,
      items: APP_MODULES.filter((m) => m.group === group && m.ownerable !== false),
    })).filter((g) => g.items.length > 0),
    [],
  );

  return (
    <div className="page">
      <PageHeader
        title="角色管理"
        subtitle="维护角色、可访问模块与主负责模块；权限调整对同角色用户实时生效（无需重新登录）"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增角色
          </Button>
        }
      />

      <Alert
        type="info"
        showIcon
        message="内置「系统管理员」始终拥有全部权限且不可修改；可为角色按模块指定「主负责辅导员」（该模块最高权限，本期「心理健康」已启用）；用户与角色/日志等系统管理模块仅管理员可访问。"
      />

      <Table
        rowKey="id"
        columns={columns}
        dataSource={roles}
        loading={loading}
        scroll={{ x: 1190 }}
        pagination={false}
      />

      <Modal
        title={editing ? `编辑角色 · ${editing.name}` : '新增角色'}
        open={formOpen}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setFormOpen(false)}
        okText="保存"
        cancelText="取消"
        width={isMobile ? 'calc(100vw - 24px)' : 620}
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
            name="description"
            label="角色说明"
            rules={[{ max: 100, message: '不可超过 100 个字' }]}
          >
            <Input.TextArea rows={2} placeholder="该角色的职责范围（选填）" />
          </Form.Item>

          <Form.Item label="可访问模块" required>
            <div className="role-perm-box">
              <div className="role-perm-actions">
                <Button
                  size="small"
                  type="link"
                  onClick={() => form.setFieldValue('permissions', APP_MODULES.map((m) => m.key))}
                >
                  全选
                </Button>
                <Button
                  size="small"
                  type="link"
                  onClick={() => form.setFieldsValue({ permissions: [], ownerModules: [] })}
                >
                  清空
                </Button>
              </div>
              <Form.Item name="permissions" noStyle>
                <Checkbox.Group
                  style={{ width: '100%' }}
                  onChange={(next) => {
                    // 取消某模块可访问时，同步收回其主负责（与后端子集校验/静默 prune 同口径）
                    form.setFieldValue(
                      'ownerModules',
                      (form.getFieldValue('ownerModules') ?? []).filter((k: string) => next.includes(k)),
                    );
                  }}
                >
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {groupedModules.map(({ group, items }) => (
                      <div key={group}>
                        <div className="role-perm-group">{group}</div>
                        <Space size={[16, 8]} wrap>
                          {items.map((m) => (
                            <Checkbox key={m.key} value={m.key}>{m.name}</Checkbox>
                          ))}
                        </Space>
                      </div>
                    ))}
                  </Space>
                </Checkbox.Group>
              </Form.Item>
            </div>
          </Form.Item>

          <Form.Item label="主负责模块（该模块最高权限）">
            <div className="role-perm-box">
              <Form.Item name="ownerModules" noStyle>
                <Checkbox.Group style={{ width: '100%' }}>
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {groupedOwnerModules.map(({ group, items }) => (
                      <div key={group}>
                        <div className="role-perm-group">{group}</div>
                        <Space size={[16, 8]} wrap>
                          {items.map((m) => (
                            <Checkbox key={m.key} value={m.key} disabled={!perms.includes(m.key)}>
                              {m.name}
                            </Checkbox>
                          ))}
                        </Space>
                      </div>
                    ))}
                  </Space>
                </Checkbox.Group>
              </Form.Item>
            </div>
          </Form.Item>
          <Typography.Text type="secondary">
            未勾选的模块不会出现在该角色用户的侧边菜单中，服务端接口也会同步拒绝访问。
            主负责角色在该模块拥有最高权限（查看全院学生数据 + 全部操作），须先勾选对应「可访问模块」；
            同一模块可由多个角色共同主负责。本期「心理健康」模块已启用该能力。
            「心理访谈」为功能级权限（不承载菜单），入口在心理健康页「一般关注」学生行内。
          </Typography.Text>
        </Form>
      </Modal>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        权限口径与侧边菜单、服务端接口校验共用同一份模块注册表，修改后立即生效。
      </Typography.Text>
    </div>
  );
}
