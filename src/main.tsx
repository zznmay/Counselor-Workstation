import React from 'react';
import ReactDOM from 'react-dom/client';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

/* antd 的 reset.css 只有几 KB，放在首屏保证登录页与工作台的基础排版一致；
   组件库 JS 仍由路由按需加载，不进入登录首屏。 */
import 'antd/dist/reset.css';
import '@/styles/global.css';
import '@/styles/mobile.css'; /* 移动端呈现层：整份包在 @media (max-width:768px) 内，桌面端零影响 */
import App from './App';

dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
