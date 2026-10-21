import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';

import { theme } from '@/theme';

import BasicLayout from './BasicLayout';

/** 登录后工作台外壳：antd 主题与消息上下文只在需要时加载，不进入登录首屏 */
export default function WorkbenchShell() {
  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      <AntdApp>
        <BasicLayout />
      </AntdApp>
    </ConfigProvider>
  );
}
