/**
 * PC 端「心理访谈记录单」填写/修订弹窗。
 * 题目以生效记录单模板为准（服务端按学生年级解析，经 view.form 下发）；
 * 编辑历史记录时按该记录填写时的题目快照校验（record.formGroups）。
 * 写权由服务端判定（canInterview / 记录提交人），前端只负责表单校验与提交。
 */
import { DatePicker, App, Checkbox, Form, Input, Modal, Radio, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';

import { createMentalInterview, updateMentalInterview } from '@/api/mental';
import {
  DEFAULT_INTERVIEW_FORM,
  INTERVIEW_DATE_LABEL,
  INTERVIEW_LEVELS,
  INTERVIEW_REQUIRED,
  LEVEL_ASSESSMENT_LABEL,
  SIGNATURE_CONFIRM_TEXT,
} from '@/constants/interview';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getStoredUser } from '@/lib/auth';
import { currentSemester, previousSemester, todayCN } from '@/lib/semester';
import type { Id, InterviewFormModel, InterviewLevel, MentalInterview } from '@/types';
import { collectAnswersWith, formQuestionCount, recordFormOf } from './shared';

type InterviewFormValues = {
  interviewDate: Dayjs;
  levelAfter: InterviewLevel;
  signatureConfirmed: boolean;
} & { [key: string]: string | Dayjs | InterviewLevel | boolean | undefined };

export interface InterviewStudentRef {
  id: Id;
  name: string;
  className?: string | null;
  studentNo?: string;
}

interface InterviewFormModalProps {
  open: boolean;
  student: InterviewStudentRef | null;
  /** 编辑态传入记录 */
  record?: MentalInterview | null;
  /** 生效记录单模板（新增态按学生年级解析；缺省用内置默认单） */
  form?: InterviewFormModel;
  onClose: () => void;
  onSaved: (result: { done: number; levelSynced: boolean; levelAfter: InterviewLevel }) => void;
}

/** 新增/修订共用的提交体组装 */
function buildPayload(values: InterviewFormValues, withRequestId: boolean, form: InterviewFormModel) {
  const answers = collectAnswersWith(values, form);
  return {
    interviewDate: values.interviewDate.format('YYYY-MM-DD'),
    levelAfter: values.levelAfter,
    answers,
    summary: answers.summary ?? '',
    signatureConfirmed: values.signatureConfirmed === true,
    ...(withRequestId ? { clientRequestId: crypto.randomUUID() } : {}),
  };
}

export default function InterviewFormModal({
  open,
  student,
  record,
  form,
  onClose,
  onSaved,
}: InterviewFormModalProps) {
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  const authUser = getStoredUser();
  const [formInst] = Form.useForm<InterviewFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const semesterLabel = record?.semesterLabel ?? currentSemester().label;
  const prevSem = previousSemester(currentSemester());

  // 生效表单：编辑态用记录快照（模板改题不追溯）；新增态用按年级解析的模板
  const activeForm = record
    ? recordFormOf(record, form ?? DEFAULT_INTERVIEW_FORM)
    : (form ?? DEFAULT_INTERVIEW_FORM);
  const questionCount = formQuestionCount(activeForm);

  useEffect(() => {
    if (!open) return;
    formInst.resetFields();
    if (record) {
      formInst.setFieldsValue({
        ...record.answers,
        levelAfter: record.levelAfter,
        interviewDate: dayjs(record.interviewDate),
        signatureConfirmed: true,
      });
    } else {
      formInst.setFieldsValue({ interviewDate: dayjs(todayCN()) });
    }
  }, [open, record, formInst]);

  const handleSubmit = async () => {
    if (!student) return;
    let values: InterviewFormValues;
    try {
      values = await formInst.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      if (record) {
        const res = await updateMentalInterview(record.id, buildPayload(values, false, activeForm));
        const syncTip = res.levelSynced
          ? `；关注等级已同步为「${values.levelAfter}」`
          : res.levelSyncSkipped
            ? '；关注等级已被其他操作调整，本次未覆盖'
            : '';
        message.success(`已保存修订（本学期 ${res.done}/${INTERVIEW_REQUIRED} 次）${syncTip}`);
        onSaved({ done: res.done, levelSynced: res.levelSynced, levelAfter: values.levelAfter });
      } else {
        const res = await createMentalInterview({ studentId: String(student.id), ...buildPayload(values, true, activeForm) });
        const syncTip = res.levelSynced
          ? values.levelAfter === '无需关注'
            ? '；已将该生标记为「无需关注」，保留在心理健康模块中'
            : `；关注等级已同步为「${values.levelAfter}」`
          : '';
        message.success(`已提交第 ${res.done} 次访谈（本学期 ${res.done}/${INTERVIEW_REQUIRED}）${syncTip}`);
        onSaved({ done: res.done, levelSynced: res.levelSynced, levelAfter: values.levelAfter });
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        record
          ? `修订心理访谈记录 · ${student?.name ?? ''}`
          : `心理访谈记录单 · ${student?.name ?? ''}`
      }
      open={open}
      confirmLoading={submitting}
      onOk={handleSubmit}
      onCancel={onClose}
      okText={record ? '保存修订' : '提交访谈'}
      cancelText="取消"
      width={isMobile ? 'calc(100vw - 24px)' : 860}
      maskClosable={false}
      styles={{ body: { maxHeight: '66vh', overflowY: 'auto', paddingRight: 4 } }}
    >
      <Form form={formInst} layout="vertical" disabled={submitting}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '10px 12px',
            marginBottom: 12,
            background: 'rgba(95, 134, 255, 0.06)',
            borderRadius: 8,
          }}
        >
          <span style={{ fontWeight: 600 }}>被访谈学生：{student?.name ?? '—'}</span>
          <Typography.Text type="secondary">班级：{student?.className ?? '—'}</Typography.Text>
          {student?.studentNo && <Typography.Text type="secondary">学号：{student.studentNo}</Typography.Text>}
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>{semesterLabel}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            记录单：{activeForm.name}（{questionCount} 题）
          </Typography.Text>
        </div>

        {activeForm.groups.map((group) => (
          <div key={group.title} style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600, margin: '6px 0 2px' }}>{group.title}</div>
            {group.questions.map((q) => (
              <Form.Item
                key={q.key}
                name={q.key}
                label={q.text}
                rules={[
                  { required: true, message: '请填写本题' },
                  { max: q.max, message: `不可超过 ${q.max} 字` },
                ]}
                style={{ marginBottom: 14 }}
              >
                <Input.TextArea
                  rows={q.rows}
                  maxLength={q.max}
                  showCount
                  placeholder={q.placeholder}
                />
              </Form.Item>
            ))}
          </div>
        ))}

        <Form.Item
          name="levelAfter"
          label={LEVEL_ASSESSMENT_LABEL}
          rules={[{ required: true, message: '请选择评估等级' }]}
        >
          <Radio.Group
            options={INTERVIEW_LEVELS.map((l) => ({ value: l, label: l }))}
            optionType="button"
            buttonStyle="solid"
          />
        </Form.Item>

        <Form.Item
          name="interviewDate"
          label={INTERVIEW_DATE_LABEL}
          rules={[{ required: true, message: '请选择访谈时间' }]}
          extra="仅可选择本学期或上一学期（假期补录），且不能晚于今天"
        >
          <DatePicker
            format="YYYY-MM-DD"
            style={{ width: 180 }}
            allowClear={false}
            disabledDate={(d) => {
              const s = d.format('YYYY-MM-DD');
              return s > todayCN() || s < prevSem.startDate;
            }}
          />
        </Form.Item>

        <Form.Item label="访谈教师签字">
          <Typography.Text strong>电子签名：{authUser?.displayName ?? '—'}</Typography.Text>
        </Form.Item>

        <Form.Item
          name="signatureConfirmed"
          valuePropName="checked"
          rules={[
            {
              validator: (_, v: boolean) =>
                v ? Promise.resolve() : Promise.reject(new Error('请勾选签字确认')),
            },
          ]}
        >
          <Checkbox>{SIGNATURE_CONFIRM_TEXT}</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
}
