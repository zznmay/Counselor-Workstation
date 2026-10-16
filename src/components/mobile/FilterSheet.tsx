import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { MIcon } from './icons';

interface FilterSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** 筛选字段区（.m-sheet-body 内） */
  children: ReactNode;
  /** 底部操作区（重置 / 确定） */
  footer?: ReactNode;
}

/**
 * 底部抽屉（筛选面板）：≤768px 的 modal 形态。
 * 纪律：遮罩用 fixed（全屏浮层，非吸附栏）；抽屉本体 max-height:92dvh；
 *       支持 Esc 关闭与点遮罩关闭；打开时锁定 body 滚动（唯一滚动容器在抽屉内）。
 */
export default function FilterSheet({ open, title, onClose, children, footer }: FilterSheetProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="m-sheet-mask"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="m-sheet">
        <div className="m-sheet-head">
          <span style={{ flex: 1 }}>{title}</span>
          <button type="button" className="m-refresh" aria-label="关闭筛选" onClick={onClose}>
            <MIcon name="x" size={20} />
          </button>
        </div>
        <div className="m-sheet-body">{children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
