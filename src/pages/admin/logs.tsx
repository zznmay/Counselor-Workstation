import { SearchOutlined } from '@ant-design/icons';
import { App, Button, Card, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';

import { getAccessLogs } from '@/api/admin';
import type { AccessLogItem } from '@/api/admin';
import PageHeader from '@/components/PageHeader';

/** 系统管理：访问日志查询（登录与所有写操作自动留痕，仅管理员可见） */
export default function AdminLogs() {
  const { message } = App.useApp();
  const [list, setList] = useState<AccessLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [usernameInput, setUsernameInput] = useState('');
  const [query, setQuery] = useState<{ username?: string; page: number }>({ page: 1 });
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAccessLogs({
        username: query.username,
        page: query.page,
        pageSize: 20,
      });
      setList(res.list);
      setTotal(res.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [query, message]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const columns: ColumnsType<AccessLogItem> = [
    { title: '时间', dataIndex: 'ts', width: 170 },
    { title: '账号', dataIndex: 'username', width: 110 },
    { title: 'IP', dataIndex: 'ip', width: 140 },
    {
      title: '操作',
      dataIndex: 'action',
      ellipsis: true,
    },
    {
      title: '结果',
      dataIndex: 'status',
      width: 110,
      render: (status: string) =>
        status === '成功' ? (
          <span style={{ color: 'var(--success, #5CA97F)' }}>{status}</span>
        ) : (
          <span style={{ color: '#d9645c' }}>{status}</span>
        ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="访问日志"
        subtitle="系统自动记录所有登录事件与数据写入操作，敏感操作可追溯"
      />

      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(47,62,102,0.35)' }} />}
          placeholder="按账号筛选"
          style={{ width: 220 }}
          value={usernameInput}
          onChange={(e) => setUsernameInput(e.target.value)}
          onPressEnter={() => setQuery({ username: usernameInput, page: 1 })}
        />
        <Button
          icon={<SearchOutlined />}
          onClick={() => setQuery({ username: usernameInput, page: 1 })}
        >
          查询
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={list}
        loading={loading}
        scroll={{ x: 800 }}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 条记录`,
          onChange: (p) => setQuery((q) => ({ ...q, page: p })),
        }}
      />
    </div>
  );
}
