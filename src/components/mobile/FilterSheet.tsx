import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { MIcon } from './icons';

interface FilterSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** 筛选字段区（.m-sheet-body 内） */
  children: ReactNode;
  /** 底部操作区（重置 / 确定） */
  footer?: ReactNode;
  /** 全屏形态（长表单/详情）：height:100dvh、隐藏拖拽条、适配软键盘 */
  fullscreen?: boolean;
  /** 点遮罩是否可关闭；长表单建议 false（防误触丢数据），默认 true */
  dismissible?: boolean;
}

/**
 * 底部抽屉（筛选面板 / 表单容器）：≤768px 的 modal 形态。
 * 纪律：遮罩用 fixed（全屏浮层，非吸附栏）；抽屉本体 max-height:92dvh；
 *       支持 Esc 关闭与点遮罩关闭（dismissible 可关）；打开时锁定 body 滚动（唯一滚动容器在抽屉内）。
 * 全屏形态（fullscreen）：height:100dvh 用于长表单；监听 visualViewport 把键盘高度
 *       写入 --kb-h，底部操作栏随键盘上移，避免「下一步/提交」被输入法遮挡。
 */
export default function FilterSheet({
  open,
  title,
  onClose,
  children,
  footer,
  fullscreen = false,
  dismissible = true,
}: FilterSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);

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

  // 全屏形态：软键盘弹出时把键盘高度写入 --kb-h，供 footer 加 padding 让出空间
  useEffect(() => {
    if (!open || !fullscreen) return undefined;
    const vv = window.visualViewport;
    const el = sheetRef.current;
    if (!vv || !el) return undefined;
    const update = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      el.style.setProperty('--kb-h', `${kb}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      el.style.setProperty('--kb-h', '0px');
    };
  }, [open, fullscreen]);

  if (!open) return null;

  return (
    <div
      className="m-sheet-mask"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={sheetRef} className={`m-sheet${fullscreen ? ' m-sheet-full' : ''}`}>
        <div className="m-sheet-head">
          <span style={{ flex: 1 }}>{title}</span>
          <button type="button" className="m-refresh" aria-label="关闭" onClick={onClose}>
            <MIcon name="x" size={20} />
          </button>
        </div>
        <div className="m-sheet-body">{children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
