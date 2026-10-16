import { useEffect, useState } from 'react';

/**
 * 脱敏字段：默认掩码 → 点击「查看」显明文 → 离开组件（页面）自动回隐。
 * 手机号规则：保留前 3 位与后 4 位，中间 4 位以 * 代替（11 位号段）。
 * 其他长度按同比例保留首尾各 3 / 2 位。
 */
export function maskValue(value: string): string {
  const v = value.trim();
  if (!v) return '—';
  if (v.length <= 7) return `${v.slice(0, 2)}****${v.slice(-2)}`;
  if (v.length === 11) return `${v.slice(0, 3)}****${v.slice(-4)}`;
  return `${v.slice(0, 3)}****${v.slice(-3)}`;
}

interface MaskedValueProps {
  value: string;
  /** 同一屏多个脱敏字段时用于 a11y 区分（如「父亲电话」） */
  label?: string;
}

export default function MaskedValue({ value, label }: MaskedValueProps) {
  const [revealed, setRevealed] = useState(false);

  // 离开组件（卸载 = 离开页面/详情）自动回隐，不写 localStorage
  useEffect(() => () => setRevealed(false), []);

  if (!value) return <span className="m-t4">—</span>;

  return (
    <span>
      <span className={revealed ? 'm-mask-row' : undefined} style={{ display: 'inline-block' }}>
        <span className="m-nowrap">{revealed ? value : maskValue(value)}</span>
        <button
          type="button"
          className="m-mask-btn"
          onClick={() => setRevealed((v) => !v)}
          aria-label={label ? `${revealed ? '隐藏' : '查看'}${label}` : undefined}
        >
          {revealed ? '隐藏' : '查看'}
        </button>
      </span>
      {revealed && <div className="m-mask-hint">已展示明文，离开本页自动隐藏</div>}
    </span>
  );
}
