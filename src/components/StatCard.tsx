import { Card } from 'antd';
import type { ReactNode } from 'react';

/**
 * 关键数据卡片：单色系水彩渐变图标底座 + 数值 + 标签 + 右侧跳转链接。
 * 首页通过 stat-row 使其悬浮于水彩横幅下缘，形成分层效果。
 */
export default function StatCard({
  icon,
  color,
  label,
  value,
  extra,
}: {
  icon: ReactNode;
  color: string;
  label: string;
  value: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <Card className="stat-card">
      <div
        className="stat-icon"
        style={{
          color,
          background: `linear-gradient(135deg, ${color}14, ${color}30)`,
          boxShadow: `inset 0 0 0 1px ${color}1f`,
        }}
      >
        {icon}
      </div>
      <div className="stat-meta">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
      {extra && <div className="stat-extra">{extra}</div>}
    </Card>
  );
}
