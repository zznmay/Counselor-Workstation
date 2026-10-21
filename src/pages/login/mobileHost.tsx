import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';

import { theme } from '@/theme';

import LoginMobile from './mobile';

/** 移动端登录页依赖 antd 消息提示，单独按需加载；桌面端登录不加载 antd */
export default function LoginMobileHost() {
  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      <AntdApp component={false}>
        <LoginMobile />
      </AntdApp>
    </ConfigProvider>
  );
}
