/**
 * xlsx 懒加载入口：SheetJS 体积约 470KB，只有用户真正导入/导出时才需要。
 * 各 Excel 工具模块统一从这里取模块，避免页面打开就下载/解析整个表格库。
 */
export type XLSXModule = typeof import('xlsx');

let modulePromise: Promise<XLSXModule> | null = null;

export function loadXLSX(): Promise<XLSXModule> {
  if (!modulePromise) {
    modulePromise = import('xlsx').catch((e) => {
      // 失败不缓存，下次点击可重试（网络抖动/发布换包场景）
      modulePromise = null;
      throw e;
    });
  }
  return modulePromise;
}
