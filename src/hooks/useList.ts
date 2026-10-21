import { useCallback, useEffect, useRef, useState } from 'react';

import type { PageQuery, PageResult } from '@/types';

/**
 * 列表页通用数据 Hook：封装查询参数、分页、加载状态与刷新。
 *
 * @param fetcher      api 层查询函数（模块级函数，引用稳定，不会触发重复请求）
 * @param initialQuery 初始查询条件（含分页）
 *
 * patchQuery(partial)      —— 更新筛选条件，并自动回到第 1 页
 * patchQuery(partial, false) —— 仅更新分页参数，不重置页码
 */
export function useList<T, Q extends PageQuery>(
  fetcher: (query: Q) => Promise<PageResult<T>>,
  initialQuery: Q,
) {
  const [query, setQuery] = useState<Q>(initialQuery);
  const [data, setData] = useState<PageResult<T>>({
    list: [],
    total: 0,
    page: 1,
    pageSize: initialQuery.pageSize,
  });
  const [loading, setLoading] = useState(false);

  const queryRef = useRef(query);
  queryRef.current = query;
  /** 请求序号：快速切换筛选时只接受最后一次响应，避免旧请求覆盖新结果 */
  const seqRef = useRef(0);

  const run = useCallback(
    async (q: Q) => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const next = await fetcher(q);
        if (seq === seqRef.current) setData(next);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [fetcher],
  );

  useEffect(() => {
    void run(query);
  }, [query, run]);

  const patchQuery = useCallback((patch: Partial<Q>, resetPage = true) => {
    setQuery((prev) => ({ ...prev, ...patch, ...(resetPage ? { page: 1 } as Partial<Q> : {}) }));
  }, []);

  const refresh = useCallback(() => {
    void run(queryRef.current);
  }, [run]);

  return { query, patchQuery, data, loading, refresh };
}
