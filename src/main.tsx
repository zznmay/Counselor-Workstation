import React from 'react';
import ReactDOM from 'react-dom/client';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

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
