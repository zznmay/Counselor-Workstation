import {
  DownloadOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Modal, Space, Table, Typography, Upload } from 'antd';
import { useState } from 'react';

import { confirmTeacherImport, previewTeacherImport } from '@/api/teachers';
import {
  downloadTeacherTemplate,
  exportTeacherImportFailures,
  parseTeacherExcel,
  validateTeacherRows,
} from '@/utils/teacherImport';
import type { ParsedTeacherRow, TeacherImportFailure, TeacherImportResult } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 导入成功（含回放）后回调，供调用方刷新列表 */
  onDone?: () => void;
}

/**
 * 教师名单批量导入面板（两段式：预览 → 确认）。
 *
 * 设计（与方案文档 §4 一致）：
 * - 预览 POST /classes/teachers/import/preview：只校验不写入，返回 batchId 与逐行失败明细；
 * - 确认 POST /classes/teachers/import/confirm：按 rows 重校验并事务写入，
 *   带 clientRequestId 保证重复提交幂等（同一批次只生效一次，第二次回放首次结果）；
 * - 默认 partial（失败行跳过、成功行生效）；可勾选「整批模式」：存在失败行则一行不写。
 *
 * 校验规则与服务端同口径（工号/姓名/手机号/人员类型/班级/在职状态），
 * 字典类（班级是否存在、工号是否已建号、是否命中管理员）由服务端兜底。
 */
export default function TeacherImportPanel({ open, onClose, onDone }: Props) {
  const { message } = App.useApp();
  const [strict, setStrict] = useState(false);
  const [parsed, setParsed] = useState<{
    fileName: string;
    totalRows: number;
    valid: ParsedTeacherRow[];
    failures: TeacherImportFailure[];
  } | null>(null);
  const [result, setResult] = useState<TeacherImportResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const reset = () => {
    setParsed(null);
    setResult(null);
  };

  const handleFile = async (file: File) => {
    setPreviewing(true);
    try {
      const rows = await parseTeacherExcel(file);
      if (rows.length === 0) {
        message.warning('未解析到数据行，请检查文件内容');
        return;
      }
      const { valid, failures } = validateTeacherRows(rows);
      const preview = await previewTeacherImport(valid);
      setParsed({ fileName: file.name, totalRows: rows.length, valid, failures });
      setResult(null);
      if (preview.validCount === 0) {
        message.warning('没有可导入的数据行，请根据失败原因修正后重新上传');
      } else {
        message.success(`预检完成：可导入 ${preview.validCount} 行，${preview.failures.length} 行存在问题`);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '文件解析失败，请使用标准模板填写');
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirm = async () => {
    if (!parsed || parsed.valid.length === 0) return;
    setConfirming(true);
    try {
      // clientRequestId 由「文件名 + 行数 + 首行工号」派生：同一份文件重复提交不会重复建号
      const clientRequestId = `timp-${parsed.fileName}-${parsed.valid.length}-${parsed.valid[0]?.data.employeeNo ?? ''}`;
      const res = await confirmTeacherImport({
        rows: parsed.valid,
        clientRequestId,
        mode: strict ? 'all-or-nothing' : 'partial',
      });
      setResult(res);
      if (res.idempotentReplay) {
        message.info('该批次此前已导入，已回放首次结果，未重复写入');
      } else {
        message.success(
          `导入完成：新增 ${res.insertedCount}、更新 ${res.updatedCount}、跳过 ${res.skippedCount}、离职 ${res.disabledCount}`,
        );
      }
      onDone?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setConfirming(false);
    }
  };

  const allFailures: TeacherImportFailure[] = parsed
    ? [...parsed.failures, ...(result?.failures ?? [])]
    : [];

  return (
    <Modal
      title="批量导入教师名单"
      width={820}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={() => { reset(); onClose(); }}>
          关闭
        </Button>,
        <Button
          key="confirm"
          type="primary"
          loading={confirming}
          disabled={!parsed || parsed.valid.length === 0 || !!result}
          onClick={handleConfirm}
        >
          {parsed ? `确认导入 ${parsed.valid.length} 行` : '确认导入'}
        </Button>,
      ]}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div className="import-step">
          <div className="import-step-title">① 下载并填写模板</div>
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={downloadTeacherTemplate}>
              下载 Excel 模板
            </Button>
            <Typography.Text type="secondary">
              工号即登录账号（初始密码 Hzpt@工号，首次登录须修改）；人员类型填「辅导员」或「班主任」，双身份用「、」分隔
            </Typography.Text>
          </Space>
        </div>

        <div className="import-step">
          <div className="import-step-title">② 上传填写好的 Excel</div>
          <Upload.Dragger
            accept=".xlsx,.xls"
            maxCount={1}
            showUploadList={false}
            disabled={!!result || previewing}
            beforeUpload={(file) => {
              void handleFile(file);
              return false;
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
            <p className="ant-upload-hint">支持 .xlsx / .xls；单次最多 2000 行；先预检后确认，可预览失败明细</p>
          </Upload.Dragger>
        </div>

        <div className="import-step">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
            <span>整批模式：任一行校验失败则全部放弃（默认逐行导入，失败行跳过）</span>
          </label>
        </div>

        {parsed && (
          <div className="import-step">
            <div className="import-step-title">{result ? '④ 导入结果' : '③ 预检结果'}</div>
            <Alert
              showIcon
              type={allFailures.length > 0 ? 'warning' : 'success'}
              message={
                result
                  ? `处理完成：新增 ${result.insertedCount}、更新 ${result.updatedCount}、跳过 ${result.skippedCount}、离职 ${result.disabledCount}，失败 ${allFailures.length} 行。`
                  : `文件「${parsed.fileName}」共解析 ${parsed.totalRows} 行：可导入 ${parsed.valid.length} 行，${parsed.failures.length} 行存在问题。`
              }
              description={
                result
                  ? result.syncSummary
                    ? `账号同步：建号 ${result.syncSummary.createdUsers}、授予角色 ${result.syncSummary.grantedRoles}、`
                      + `回收角色 ${result.syncSummary.revokedRoles}、新增带班 ${result.syncSummary.linkedClasses}、`
                      + `解除带班 ${result.syncSummary.unlinkedClasses}、回填学生 ${result.syncSummary.refilledStudents} 名。`
                    : undefined
                  : '导入按工号 upsert：工号不存在则自动建号；已存在则绑定账号并更新有变化的字段，完全相同自动跳过。'
              }
            />
            {allFailures.length > 0 && (
              <>
                <Table
                  size="small"
                  rowKey={(r) => `${r.row}-${r.field}`}
                  style={{ marginTop: 12 }}
                  columns={[
                    { title: 'Excel 行号', dataIndex: 'row', width: 90 },
                    { title: '出错字段', dataIndex: 'field', width: 100 },
                    { title: '工号', dataIndex: 'employeeNo', width: 110 },
                    { title: '姓名', dataIndex: 'name', width: 90 },
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
                  onClick={() => exportTeacherImportFailures(allFailures)}
                >
                  导出失败明细
                </Button>
              </>
            )}
            {parsed.valid.length > 0 && !result && (
              <Alert
                showIcon
                type="info"
                icon={<ExclamationCircleOutlined />}
                style={{ marginTop: 12 }}
                message="确认后将写入的数据"
                description={`新建/更新账号、授予人员类型角色、绑定带班关系，并按班级回填学生名册的班主任/辅导员（当前为${strict ? '整批' : '逐行'}模式）。`}
              />
            )}
          </div>
        )}
      </Space>
    </Modal>
  );
}
