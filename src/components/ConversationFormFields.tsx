import { DatePicker, Form, Input, Radio, Select, Space } from 'antd';
import type { Dayjs } from 'dayjs';

import { TALK_TYPES, TALK_WAYS, toOptions } from '@/constants';
import type { ConversationInput, TalkType, TalkWay } from '@/types';

export interface ConversationFormValues {
  talkTime: Dayjs;
  way: TalkWay;
  type: TalkType;
  needFollowUp: boolean;
  content: string;
  followUp?: string;
}

/**
 * 谈话记录表单的公共字段（不含学生选择）。
 * 谈心谈话模块与「学生管理-记录谈话」共用，保证两处录入的字段与校验一致。
 */
export default function ConversationFormFields() {
  return (
    <>
      <Space size={16} wrap style={{ display: 'flex' }}>
        <Form.Item
          name="talkTime"
          label="谈话时间"
          rules={[{ required: true, message: '请选择谈话时间' }]}
        >
          <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: 190 }} />
        </Form.Item>
        <Form.Item name="way" label="谈话方式" rules={[{ required: true }]}>
          <Select options={toOptions(TALK_WAYS)} style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="type" label="谈话类型" rules={[{ required: true }]}>
          <Select options={toOptions(TALK_TYPES)} style={{ width: 130 }} />
        </Form.Item>
        <Form.Item name="needFollowUp" label="是否需要跟进">
          <Radio.Group>
            <Radio value={true}>需要跟进</Radio>
            <Radio value={false}>无需跟进</Radio>
          </Radio.Group>
        </Form.Item>
      </Space>
      <Form.Item
        name="content"
        label="谈话内容"
        rules={[{ required: true, message: '请填写谈话内容' }]}
      >
        <Input.TextArea rows={4} placeholder="记录谈话要点、学生反馈与处理方式" />
      </Form.Item>
      <Form.Item name="followUp" label="后续跟进事项">
        <Input.TextArea rows={2} placeholder="需要持续关注或落实的事项（选填）" />
      </Form.Item>
    </>
  );
}

/** 表单值 → api 入参（studentId 由调用方提供） */
export function conversationFormToInput(
  values: ConversationFormValues,
  studentId: string,
): ConversationInput {
  return {
    studentId,
    talkTime: values.talkTime.format('YYYY-MM-DD HH:mm'),
    way: values.way,
    type: values.type,
    needFollowUp: values.needFollowUp,
    content: values.content,
    followUp: values.followUp,
  };
}
