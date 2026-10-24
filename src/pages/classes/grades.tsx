import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, Modal, Popconfirm, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { createGrade, deleteGrade, getGrades, updateGrade } from '@/api/classes';
import PageHeader from '@/components/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAuthUser } from '@/hooks/useAuthUser';
import { canAction } from '@/lib/auth';
import type { Grade } from '@/types';

interface GradeFormValues {
  name: string;
}

/** 年级管理（桌面端）：列表 / 新增 / 编辑 / 删除（页面访问与操作均为独立权限） */
function GradesDesktop() {
  const { message } = App.useApp();
  const authUser = useAuthUser();
  const [form] = Form.useForm<GradeFormValues>();

  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Grade | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      setGrades(await getGrades());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({ name: editing.name });
    } else {
      form.resetFields();
    }
  }, [modalOpen, editing, form]);

  const handleSubmit = async () => {
    let values: GradeFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await updateGrade(editing.id, values.name);
        message.success('年级信息已更新');
      } else {
        await createGrade(values.name);
        message.success('新增年级成功');
      }
      setModalOpen(false);
      void reload();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteGrade(id);
      message.success('删除成功');
      void reload();
    } catch (e) {
      // 后端约束（年级下仍有班级）以 400 message 返回，直接展示
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const columns: ColumnsType<Grade> = [
    { title: '年级名称', dataIndex: 'name', width: 180 },
    { title: '班级数', dataIndex: 'classCount', width: 100, align: 'center' },
    { title: '创建时间', dataIndex: 'createdAt', width: 170 },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_, record) => (
        <Space size={0}>
          {canAction(authUser, 'classes', 'gradeEdit') && (
            <Button
              type="link"
              size="small"
              onClick={() => {
                setEditing(record);
                setModalOpen(true);
              }}
            >
              编辑
            </Button>
          )}
          {canAction(authUser, 'classes', 'gradeDelete') && (
            <Popconfirm
              title="确定删除该年级吗？"
              description="年级下存在班级时无法删除"
              onConfirm={() => handleDelete(record.id)}
            >
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="年级管理"
        subtitle="维护年级字典；班级须归属年级，年级下存在班级时不可删除"
        extra={
          canAction(authUser, 'classes', 'gradeCreate') ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setEditing(null);
                setModalOpen(true);
              }}
            >
              新增年级
            </Button>
          ) : undefined
        }
      />

      <Table
        rowKey="id"
        columns={columns}
        dataSource={grades}
        loading={loading}
        pagination={false}
      />

      {/* 新增 / 编辑年级 */}
      <Modal
        title={editing ? '编辑年级' : '新增年级'}
        open={modalOpen}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={420}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="年级名称"
            rules={[{ required: true, message: '请输入年级名称' }]}
          >
            <Input placeholder="如 2027级" maxLength={20} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/**
 * 视口分发：移动端的年级管理并入「班级管理」页的分段切换视图
 * （/classes 移动版内切换「班级 / 年级」），直接重定向过去。
 */
export default function Grades() {
  const isMobile = useIsMobile();
  if (isMobile) return <Navigate to="/classes" replace />;
  return <GradesDesktop />;
}
