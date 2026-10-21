import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UIEvent } from 'react';

import { searchStudentOptions } from '@/api/student';
import type { StudentOption } from '@/types';

const DEFAULT_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const LOAD_MORE_THRESHOLD = 32;

export interface UseStudentOptionsOptions {
  /** 弹窗/面板打开时才发起请求；关闭后再次打开会重新校验一次（命中缓存则本地返回） */
  enabled?: boolean;
  pageSize?: number;
  /** 仅返回当前账号可维护班级的学生 */
  manageableOnly?: boolean;
  /** 编辑态当前学生：始终置顶，避免搜索结果变化后下拉回显成裸 ID */
  selected?: StudentOption | null;
}

/**
 * 学生下拉数据源：服务端关键字搜索 + 分页加载。
 * - 输入关键字 300ms 防抖，回到第一页；
 * - 桌面 Select 用 handlePopupScroll 滚到底部加载下一页；
 * - 移动端原生 select 可配合 input 使用 search()，只展示当前关键字结果。
 */
export function useStudentOptions({
  enabled = true,
  pageSize = DEFAULT_PAGE_SIZE,
  manageableOnly = false,
  selected = null,
}: UseStudentOptionsOptions = {}) {
  const [items, setItems] = useState<StudentOption[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const seqRef = useRef(0);
  const pageRef = useRef(1);
  const keywordRef = useRef('');
  const loadedKeywordRef = useRef('');
  const loadingRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const fetchPage = useCallback(
    async (nextKeyword: string, page: number, append: boolean) => {
      const seq = ++seqRef.current;
      loadingRef.current = true;
      setLoading(true);
      try {
        const res = await searchStudentOptions({
          keyword: nextKeyword || undefined,
          page,
          pageSize,
          manageableOnly,
        });
        if (seq !== seqRef.current) return;
        setItems((prev) => {
          if (!append) return res.list;
          const seen = new Set(prev.map((s) => s.id));
          return [...prev, ...res.list.filter((s) => !seen.has(s.id))];
        });
        pageRef.current = page;
        loadedKeywordRef.current = nextKeyword;
        setHasMore(page * pageSize < res.total);
      } catch {
        if (seq !== seqRef.current) return;
        if (!append) setItems([]);
        loadedKeywordRef.current = nextKeyword;
        setHasMore(false);
      } finally {
        if (seq === seqRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [pageSize, manageableOnly],
  );

  const prevEnabledRef = useRef(false);
  useEffect(() => {
    if (!enabled) {
      prevEnabledRef.current = false;
      return undefined;
    }
    const justEnabled = !prevEnabledRef.current;
    prevEnabledRef.current = true;
    // 首次打开立即拉第一页；输入关键字时防抖，避免逐字请求
    const timer = window.setTimeout(() => {
      keywordRef.current = keyword;
      void fetchPage(keyword, 1, false);
    }, justEnabled ? 0 : SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, keyword, fetchPage]);

  const search = useCallback((value: string) => {
    keywordRef.current = value;
    setKeyword(value);
  }, []);

  const loadMore = useCallback(() => {
    if (!enabledRef.current || loadingRef.current || !hasMore) return;
    // 关键字已变化但新结果还没回来时，不要把旧关键字的下一页拼进新列表
    if (keywordRef.current !== loadedKeywordRef.current) return;
    void fetchPage(keywordRef.current, pageRef.current + 1, true);
  }, [hasMore, fetchPage]);

  const handlePopupScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_THRESHOLD) loadMore();
    },
    [loadMore],
  );

  const options = useMemo(() => {
    if (!selected) return items;
    if (items.some((s) => s.id === selected.id)) return items;
    return [selected, ...items];
  }, [items, selected]);

  return { options, loading, hasMore, search, loadMore, handlePopupScroll };
}
