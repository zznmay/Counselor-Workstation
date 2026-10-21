import { isRouteErrorResponse, useRouteError } from 'react-router-dom';

/** 路由级错误兜底：代码块加载失败/渲染异常时给出可恢复入口，避免白屏 */
export default function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : '页面加载失败';

  return (
    <div className="route-error" role="alert">
      <div className="route-error-title">页面暂时无法打开</div>
      <div className="route-error-desc">{message}</div>
      <div className="route-error-actions">
        <button type="button" className="route-error-btn" onClick={() => window.location.reload()}>
          重新加载
        </button>
        <a className="route-error-link" href="/">返回工作台</a>
      </div>
    </div>
  );
}
