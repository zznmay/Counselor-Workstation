import type { ReactNode } from 'react';

/** 页面标题区：左侧标题 + 副标题，右侧操作区 */
export default function PageHeader({
  title,
  subtitle,
  extra,
}: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="page-title">{title}</div>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {extra && <div>{extra}</div>}
    </div>
  );
}
