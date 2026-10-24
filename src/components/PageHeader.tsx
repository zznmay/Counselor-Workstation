import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import type { ReactNode } from 'react';

/** 页面标题区：左侧（可选返回按钮 +）标题 + 副标题，右侧操作区 */
export default function PageHeader({
  title,
  subtitle,
  extra,
  onBack,
}: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  /** 提供时在标题左侧渲染返回按钮（次级页面用） */
  onBack?: () => void;
}) {
  return (
    <div className="page-header">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
        {onBack && (
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
            aria-label="返回"
            style={{ marginTop: 2, flex: '0 0 auto' }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          <div className="page-title">{title}</div>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
      </div>
      {extra && <div>{extra}</div>}
    </div>
  );
}
