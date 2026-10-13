import {
  AppstoreOutlined,
  CopyOutlined,
  MergeCellsOutlined,
  PartitionOutlined,
  ScheduleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { CSSProperties } from 'react';
import type { ComponentType } from 'react';

/**
 * 实用工具注册表：新增自研小工具时只需在此追加一条记录，
 * 侧边菜单子项、工具广场卡片与 /tools/:toolKey 路由将自动生成。
 */
export interface ToolMeta {
  /** 唯一标识，对应路由参数 */
  key: string;
  /** 路由路径（/tools/:key） */
  path: string;
  title: string;
  description: string;
  icon: ComponentType<{ style?: CSSProperties }>;
  /** 内嵌工具页面地址（public/tools 下的静态 HTML） */
  embedUrl: string;
  tags: string[];
}

export const TOOLS: ToolMeta[] = [
  {
    key: 'counselor-scheduler',
    path: '/tools/counselor-scheduler',
    title: '辅导员智能排班',
    description: '录入辅导员名单与值班规则，按平均公平原则一键生成排班表并导出 Excel',
    icon: ScheduleOutlined,
    embedUrl: '/tools/counselor-scheduler/index.html',
    tags: ['值班排班', '规则引擎'],
  },
  {
    key: 'excel-splitter',
    path: '/tools/excel-splitter',
    title: 'Excel 数据拆分',
    description: '按指定列把 Excel 数据自动拆分为多个文件，支持多行表头识别与 ZIP 打包下载',
    icon: PartitionOutlined,
    embedUrl: '/tools/excel-splitter.html',
    tags: ['表格处理', '数据拆分'],
  },
  {
    key: 'sheet-merger',
    path: '/tools/sheet-merger',
    title: 'Sheet 合并工具',
    description: '合并同一 Excel 文件内多张相同格式的 Sheet，完整保留表头、合并单元格与样式',
    icon: CopyOutlined,
    embedUrl: '/tools/sheet-merger.html',
    tags: ['表格处理', 'Sheet 合并'],
  },
  {
    key: 'excel-merger',
    path: '/tools/excel-merger',
    title: 'Excel 数据匹配',
    description: '上传多个 Excel，选择匹配主键与字段，一键合并数据并导出结果表',
    icon: MergeCellsOutlined,
    embedUrl: '/tools/excel-merger.html',
    tags: ['表格处理', '数据合并'],
  },
];

/** 工具广场入口的图标（占位，便于后续扩展） */
export const TOOL_HUB_ICON: ComponentType<{ style?: CSSProperties }> = ThunderboltOutlined;
export const TOOL_INDEX_ICON: ComponentType<{ style?: CSSProperties }> = AppstoreOutlined;
