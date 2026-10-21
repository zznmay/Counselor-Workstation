import type { ThemeConfig } from 'antd';

/**
 * 设计语言：「未来界面蓝」单色系（#5F86FF / #A9C2FF / #F4F7FF / #2F3E66）+ 水彩晕染 + 分层卡片，
 * 辅以克制的蓝系渐变传达高级感。语义色做柔化处理以保留可读性。
 */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#5F86FF',
    colorInfo: '#5F86FF',
    colorLink: '#5F86FF',
    colorSuccess: '#5CA97F',
    colorWarning: '#DFA050',
    colorError: '#D9645C',
    colorTextBase: '#2F3E66',
    colorBgLayout: '#F4F7FF',
    colorBgContainer: '#FFFFFF',
    colorBorder: '#D9E3F8',
    colorBorderSecondary: '#E8EEFB',
    borderRadius: 8,
    borderRadiusLG: 16,
    fontSize: 14,
    boxShadow: '0 2px 8px rgba(47, 62, 102, 0.08)',
    boxShadowSecondary: '0 12px 32px rgba(47, 62, 102, 0.14)',
  },
  components: {
    Table: {
      headerBg: '#EDF2FF',
      headerColor: '#3D4E7A',
      rowHoverBg: '#F3F7FF',
      headerSplitColor: 'transparent',
    },
    Menu: {
      itemHeight: 42,
      itemBorderRadius: 10,
      itemMarginInline: 12,
      itemMarginBlock: 4,
    },
    Tag: {
      borderRadiusSM: 6,
    },
  },
};
