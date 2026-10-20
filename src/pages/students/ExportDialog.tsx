/** 批量导出字段选择弹窗：勾选（全选/清空）+ 上移/下移排序 + 会话内记忆，仅网页端 */
import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons';
import { Alert, App, Button, Checkbox, Modal, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';

import {
  DEFAULT_EXPORT_FIELD_KEYS,
  EXPORT_FIELD_MAP,
  EXPORT_FIELDS,
  loadExportFieldKeys,
  sanitizeCellValue,
  type ExportFieldDef,
} from '@/utils/studentExport';

interface ExportDialogProps {
  open: boolean;
  /** 确认导出（页面侧负责取数、生成文件与异常提示） */
  onConfirm: (fields: ExportFieldDef[]) => void;
  onCancel: () => void;
  /** 导出进行中：确认按钮转圈、禁止关闭 */
  exporting: boolean;
  /** 未勾选学生时的默认导出范围提示（当前筛选结果总人数） */
  filterTotal: number;
  /** 已勾选学生数（>0 时导出范围=所选学生） */
  selectedCount: number;
}

/** 字段选择行：序号 + 中文列名 + 排序按钮（仅已勾选字段可排序） */
function FieldRow({
  field,
  order,
  checked,
  onToggle,
  onMove,
  first,
  last,
}: {
  field: ExportFieldDef;
  /** 勾选字段中的显示顺序（未勾选为 -1） */
  order: number;
  checked: boolean;
  onToggle: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  return (
    <div className="export-field-row">
      <Checkbox checked={checked} onChange={onToggle}>
        <span className="export-field-label">
          {checked && <span className="export-field-order">{order + 1}</span>}
          {field.label}
        </span>
      </Checkbox>
      <Space size={0} className="export-field-actions">
        <Button
          type="text"
          size="small"
          icon={<CaretUpOutlined />}
          disabled={!checked || first}
          aria-label={`上移${field.label}`}
          onClick={() => onMove(-1)}
        />
        <Button
          type="text"
          size="small"
          icon={<CaretDownOutlined />}
          disabled={!checked || last}
          aria-label={`下移${field.label}`}
          onClick={() => onMove(1)}
        />
      </Space>
    </div>
  );
}

/**
 * 批量导出弹窗：
 * - 勾选顺序即列顺序（新勾选追加到末尾），上移/下移微调；
 * -「恢复默认」回到 DEFAULT_EXPORT_FIELD_KEYS 顺序；导出成功后由页面调用 rememberExportFieldKeys 持久到会话；
 * - 数值防公式（sanitizeCellValue）在生成文件时统一处理，这里仅做示例提示。
 */
export default function ExportDialog({ open, onConfirm, onCancel, exporting, filterTotal, selectedCount }: ExportDialogProps) {
  const { message } = App.useApp();
  /** 有序字段 key 列表：勾选与排序共用同一数组，顺序天然保持 */
  const [orderedKeys, setOrderedKeys] = useState<string[]>([]);

  useEffect(() => {
    if (open) setOrderedKeys(loadExportFieldKeys());
  }, [open]);

  const checkedSet = new Set(orderedKeys);

  const toggle = (key: string) => {
    setOrderedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const move = (key: string, dir: -1 | 1) => {
    setOrderedKeys((prev) => {
      const i = prev.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const handleConfirm = () => {
    if (orderedKeys.length === 0) {
      message.warning('请至少勾选一个导出字段');
      return;
    }
    onConfirm(orderedKeys.map((k) => EXPORT_FIELD_MAP.get(k)!).filter(Boolean));
  };

  /** 预览示例：演示 = 开头值的清洗效果（转文本前缀），不参与真实导出 */
  const sample = sanitizeCellValue('=SUM(A1:A2)');

  return (
    <Modal
      title="批量导出学生名册"
      open={open}
      onCancel={exporting ? undefined : onCancel}
      maskClosable={!exporting}
      keyboard={!exporting}
      width={640}
      footer={[
        <Button key="reset" disabled={exporting} onClick={() => setOrderedKeys([...DEFAULT_EXPORT_FIELD_KEYS])}>
          恢复默认
        </Button>,
        <Button key="cancel" disabled={exporting} onClick={onCancel}>
          取消
        </Button>,
        <Button key="ok" type="primary" loading={exporting} onClick={handleConfirm}>
          导出 Excel
        </Button>,
      ]}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          selectedCount > 0 ? (
            <>将导出已勾选的 <b>{selectedCount}</b> 名学生</>
          ) : (
            <>
              未勾选学生，将导出<b>当前筛选结果的全部 {filterTotal} 名</b>学生
            </>
          )
        }
      />
      <div className="export-toolbar">
        <Space wrap>
          <Button size="small" disabled={orderedKeys.length === EXPORT_FIELDS.length} onClick={() => setOrderedKeys(EXPORT_FIELDS.map((f) => f.key))}>
            全选
          </Button>
          <Button size="small" disabled={orderedKeys.length === 0} onClick={() => setOrderedKeys([])}>
            取消全选
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已选 {orderedKeys.length} / {EXPORT_FIELDS.length} 项；勾选顺序即列顺序，可用箭头调整
          </Typography.Text>
        </Space>
      </div>
      <div className="export-field-list">
        {/* 已勾选字段按勾选顺序排前（所见即所得：行序=列序），未勾选的按定义序排后 */}
        {[...EXPORT_FIELDS]
          .sort((a, b) => {
            const ia = orderedKeys.indexOf(a.key);
            const ib = orderedKeys.indexOf(b.key);
            if (ia >= 0 && ib >= 0) return ia - ib;
            if (ia >= 0) return -1;
            if (ib >= 0) return 1;
            return EXPORT_FIELDS.indexOf(a) - EXPORT_FIELDS.indexOf(b);
          })
          .map((field) => {
            const checked = checkedSet.has(field.key);
            const idx = orderedKeys.indexOf(field.key);
            return (
              <FieldRow
                key={field.key}
                field={field}
                order={idx}
                checked={checked}
                onToggle={() => toggle(field.key)}
                onMove={(dir) => move(field.key, dir)}
                first={idx === 0}
                last={idx === orderedKeys.length - 1}
              />
            );
          })}
      </div>
      <div style={{ marginTop: 8 }}>
        <Tag color="warning">安全提示</Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          以 =、+、-、@ 开头的内容将按纯文本导出（如 <code>{sample}</code> → <code>'{sample}</code>），避免被表格软件当作公式执行。
        </Typography.Text>
      </div>
    </Modal>
  );
}
