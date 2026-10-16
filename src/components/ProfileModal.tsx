import { Form, Input, Modal } from 'antd';
import { useEffect } from 'react';

import type { UserProfile } from '@/utils/profile';

interface ProfileFormValues {
  realName: string;
  nickname?: string;
}

/**
 * 称呼信息弹窗：
 * 首次使用（isFirst）作为引导收集真实姓名与昵称；之后作为修改入口复用。
 */
export default function ProfileModal({
  open,
  isFirst,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  isFirst: boolean;
  initial: UserProfile | null;
  onSave: (profile: UserProfile) => void;
  onClose: () => void;
}) {
  const [form] = Form.useForm<ProfileFormValues>();

  useEffect(() => {
    if (open) {
      form.setFieldsValue({ realName: initial?.realName ?? '', nickname: initial?.nickname ?? '' });
    }
  }, [open, initial, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      onSave({ realName: values.realName.trim(), nickname: values.nickname?.trim() || undefined });
    } catch {
      /* 校验失败，表单内已提示 */
    }
  };

  return (
    <Modal
      title={isFirst ? '👋 欢迎使用知行辅导员工作台' : '修改称呼信息'}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="保存"
      cancelText={isFirst ? '稍后再说' : '取消'}
      width={420}
    >
      <div style={{ color: 'rgba(0,0,0,0.55)', margin: '4px 0 16px' }}>
        {isFirst
          ? '首次使用，请告诉我们您的姓名与希望被称呼的方式，保存后系统将每天以您喜欢的方式向您问候。'
          : '保存后将在顶栏展示与每日问候中生效。'}
      </div>
      <Form form={form} layout="vertical">
        <Form.Item
          name="realName"
          label="真实姓名"
          rules={[{ required: true, message: '请输入真实姓名' }]}
        >
          <Input placeholder="如：王小雅" maxLength={20} />
        </Form.Item>
        <Form.Item
          name="nickname"
          label="希望被称呼的昵称"
          extra="不填写时，将使用真实姓名称呼您"
        >
          <Input placeholder="如：小雅老师" maxLength={20} allowClear />
        </Form.Item>
      </Form>
    </Modal>
  );
}
