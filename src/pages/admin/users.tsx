import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Form, Input, Modal, Select, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';

import { createUser, getUsers, updateUser } from '@/api/admin';
import type { ManagedUser } from '@/api/admin';
import { getClassOptions } from '@/api/classes';
import PageHeader from '@/components/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { ClassOption } from '@/types';

interface UserFormValues {
  username: string;
  displayName: string;
  role: 'admin' | 'counselor';
  password: string;
  classIds?: number[];
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
  const roleWatch = Form.useWatch('role', form);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetForm] = Form.useForm<{ password: string }>();

  /* ---------- 辅导员分班 ---------- */
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [assignTarget, setAssignTarget] = useState<ManagedUser | null>(null);
  const [assignForm] = Form.useForm<{ classIds?: number[] }>();
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    getClassOptions().then(setClassOptions).catch(() => undefined);
  }, []);

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
      // classIds 仅对辅导员生效；角色切到 admin 时丢弃该字段
      const payload = { ...values, classIds: values.role === 'counselor' ? values.classIds : undefined };
      await createUser(payload);
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
      title: '所辖班级',
      dataIndex: 'classNames',
      width: 200,
      ellipsis: true,
      render: (_, record) =>
        record.role === 'counselor'
          ? record.classNames?.length
            ? record.classNames.join('、')
            : '未分配'
          : '—',
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
      width: 290,
      render: (_, record) => (
        <span>
          {record.role !== 'admin' && (
            <Button type="link" size="small" onClick={() => openAssign(record)}>
              分配班级
            </Button>
          )}
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
        scroll={{ x: 900 }}
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
          {roleWatch === 'counselor' && (
            <Form.Item
              name="classIds"
              label="所辖班级"
              extra="可多选；也可创建后在列表中调整"
            >
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
            extra="该辅导员负责的班级，可多选；按年级分组展示"
          >
            {classSelect}
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
