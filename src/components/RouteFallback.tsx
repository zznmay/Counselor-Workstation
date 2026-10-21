/** 路由/代码块加载兜底：不依赖 antd，避免首屏为了转圈再拉一轮组件库 */
export default function RouteFallback({ full = false }: { full?: boolean }) {
  return (
    <div
      className={`route-fallback${full ? ' route-fallback-full' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="route-fallback-spinner" aria-hidden />
      <span>正在加载…</span>
    </div>
  );
}
