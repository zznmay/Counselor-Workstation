import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Form, Input, Modal, Select, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';

import { createUser, getUsers, updateUser } from '@/api/admin';
import type { ManagedUser } from '@/api/admin';
import PageHeader from '@/components/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';

interface UserFormValues {
  username: string;
  displayName: string;
  role: 'admin' | 'counselor';
  password: string;
}

/** 系统管理：账号开设、停用/启用、密码重置（仅管理员） */
export default function AdminUsers() {
  const isMobile = useIsMobile();
  const { message, modal } = App.useApp();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<UserFormValues>();
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetForm] = Form.useForm<{ password: string }>();

  const reload = async () => {
    setLoading(true);
    try {
      setUsers(await getUsers());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const handleCreate = async () => {
    let values: UserFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      await createUser(values);
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

  const columns: ColumnsType<ManagedUser> = [
    { title: '用户名', dataIndex: 'username', width: 130 },
    { title: '姓名', dataIndex: 'displayName', width: 120 },
    {
      title: '角色',
      dataIndex: 'role',
      width: 100,
      render: (role: string) =>
        role === 'admin' ? <Tag color="gold">管理员</Tag> : <Tag color="blue">辅导员</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'disabled',
      width: 90,
      render: (disabled: boolean) =>
        disabled ? <Tag color="red">已停用</Tag> : <Tag color="green">正常</Tag>,
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 150 },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_, record) => (
        <span>
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
          {record.role !== 'admin' && (
            <Button type="link" size="small" onClick={() => toggleDisabled(record)}>
              {record.disabled ? '启用' : '停用'}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="用户管理"
        subtitle="开设教师账号、重置密码与停用启用（新账号初始密码为 Hzky@123456，首次登录需修改）"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ role: 'counselor' });
              setFormOpen(true);
            }}
          >
            新增账号
          </Button>
        }
      />

      <Table
        rowKey="id"
        columns={columns}
        dataSource={users}
        loading={loading}
        scroll={{ x: 800 }}
        pagination={false}
        rowClassName={(record) => (record.disabled ? 'row-disabled' : '')}
      />

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
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'counselor', label: '辅导员' },
                { value: 'admin', label: '管理员' },
              ]}
            />
          </Form.Item>
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
    </div>
  );
}
