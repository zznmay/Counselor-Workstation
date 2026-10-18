import {
  AlertOutlined,
  CheckSquareOutlined,
  CommentOutlined,
  RightOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { App, Button, Card, Checkbox, Col, List, Row, Space, Spin, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDashboardStats } from '@/api/dashboard';
import { updateTodo } from '@/api/todo';
import StatCard from '@/components/StatCard';
import {
  TODO_PRIORITY_COLOR,
  WARNING_LEVEL_COLOR,
  WARNING_TYPE_COLOR,
} from '@/constants';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getStoredUser } from '@/lib/auth';
import type { DashboardStats, Todo } from '@/types';
import DashboardMobile from './mobile';

/** 迷你条形图（纯 CSS 实现，无图表库依赖） */
function MiniBars({ data, color }: { data: { label: string; count: number }[]; color: string }) {
  const max = Math.max(...data.map((item) => item.count), 1);
  return (
    <div>
      {data.map((item) => (
        <div className="mini-bar-row" key={item.label}>
          <span className="mini-bar-label">{item.label}</span>
          <div className="mini-bar-track">
            <div
              className="mini-bar-fill"
              style={{ width: `${(item.count / max) * 100}%`, background: color }}
            />
          </div>
          <span className="mini-bar-count">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

/** 首页工作台：今日待办、待处理审批、预警名单、关键数据卡片与分布概览 */
function DashboardDesktop() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [stats, setStats] = useState<DashboardStats | null>(null);

  const reload = useCallback(() => {
    getDashboardStats()
      .then(setStats)
      .catch(() => message.error('工作台数据加载失败'));
  }, [message]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCompleteTodo = async (todo: Todo) => {
    await updateTodo(todo.id, { status: '已完成' });
    message.success('待办已完成');
    reload();
  };

  if (!stats) {
    return (
      <div style={{ textAlign: 'center', padding: '120px 0' }}>
        <Spin tip="正在加载工作台数据…" size="large" />
      </div>
    );
  }

  const hour = dayjs().hour();
  const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
  const todayStr = dayjs().format('YYYY-MM-DD');
  const shownName = getStoredUser()?.displayName || '老师';

  return (
    <div className="page">
      <div className="hero-wrap">
        <Card className="hero-card" bordered={false}>
          <div className="hero-greet">
            <div className="hero-title">
              {greeting}，{shownName}！今天有 {stats.todayTodoCount} 项待办、
              {stats.pendingWarningCount} 名预警学生需要关注。
            </div>
            <div className="hero-sub">
              {dayjs().format('YYYY年MM月DD日 dddd')} · 知行辅导员工作台
            </div>
          </div>
          <div className="hero-art" aria-hidden>
            🎓
          </div>
          <span className="hero-chip hero-chip-1" aria-hidden>
            📚
          </span>
          <span className="hero-chip hero-chip-2" aria-hidden>
            🌱
          </span>
        </Card>

        <Row gutter={[16, 16]} className="stat-row">
          <Col xs={12} lg={6}>
            <StatCard
              icon={<TeamOutlined />}
              color="#4a6fe3"
              label="在读学生"
              value={stats.studentCount}
              extra={
                <Button type="link" size="small" onClick={() => navigate('/students')}>
                  学生名册 <RightOutlined />
                </Button>
              }
            />
          </Col>
          <Col xs={12} lg={6}>
            <StatCard
              icon={<CommentOutlined />}
              color="#5f86ff"
              label="本月谈心谈话"
              value={stats.monthTalkCount}
              extra={
                <Button type="link" size="small" onClick={() => navigate('/conversations')}>
                  谈话记录 <RightOutlined />
                </Button>
              }
            />
          </Col>
          <Col xs={12} lg={6}>
            <StatCard
              icon={<AlertOutlined />}
              color="#7d9bff"
              label="未解除预警学生"
              value={stats.pendingWarningCount}
              extra={
                <Button type="link" size="small" onClick={() => navigate('/warnings?status=待处理')}>
                  去处理 <RightOutlined />
                </Button>
              }
            />
          </Col>
          <Col xs={12} lg={6}>
            <StatCard
              icon={<CheckSquareOutlined />}
              color="#9db4ff"
              label="今日待办"
              value={
                <Space size={8}>
                  {stats.todayTodoCount}
                  {stats.overdueTodoCount > 0 && (
                    <Tag color="red" style={{ marginInlineEnd: 0 }}>
                      逾期 {stats.overdueTodoCount}
                    </Tag>
                  )}
                </Space>
              }
              extra={
                <Button type="link" size="small" onClick={() => navigate('/todos')}>
                  全部待办 <RightOutlined />
                </Button>
              }
            />
          </Col>
        </Row>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                预警学生名单
                <Tag color="red">{stats.pendingWarningCount} 人</Tag>
              </Space>
            }
            extra={
              <Button type="link" size="small" onClick={() => navigate('/warnings?status=待处理')}>
                全部预警
              </Button>
            }
          >
            <List
              dataSource={stats.recentWarnings}
              renderItem={(w) => (
                <List.Item
                  actions={[
                    <Button
                      key="go"
                      type="link"
                      size="small"
                      onClick={() => navigate('/warnings?status=待处理')}
                    >
                      去处理
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space size={8} wrap>
                        <Tag color={WARNING_LEVEL_COLOR[w.level]}>{w.level}预警</Tag>
                        <span style={{ fontWeight: 600 }}>{w.studentName}</span>
                        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                          {w.className} · {w.studentNo}
                        </span>
                      </Space>
                    }
                    description={
                      <Typography.Paragraph
                        type="secondary"
                        ellipsis={{ rows: 1, tooltip: w.reason }}
                        style={{ marginBottom: 0 }}
                      >
                        {w.reason}
                      </Typography.Paragraph>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                今日待办
                <Tag color="purple">{stats.todayTodoCount} 项</Tag>
              </Space>
            }
            extra={
              <Button type="link" size="small" onClick={() => navigate('/todos')}>
                全部待办
              </Button>
            }
          >
            <List
              dataSource={stats.todayTodos}
              renderItem={(t) => {
                const overdue = t.dueDate < todayStr;
                return (
                  <List.Item
                    actions={[
                      <Checkbox key="done" onChange={() => handleCompleteTodo(t)}>
                        完成
                      </Checkbox>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Space size={8} wrap>
                          <Tag color={TODO_PRIORITY_COLOR[t.priority]}>{t.priority}</Tag>
                          <span style={{ fontWeight: 600 }}>{t.title}</span>
                        </Space>
                      }
                      description={
                        <Space size={8} wrap>
                          <span style={{ color: overdue ? '#cf1322' : 'rgba(0,0,0,0.45)' }}>
                            截止 {t.dueDate} {t.dueTime}
                          </span>
                          {overdue && <Tag color="red">已逾期</Tag>}
                        </Space>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card title="数据概览">
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              未解除预警类型分布
            </Typography.Title>
            <MiniBars data={stats.warningByType} color="linear-gradient(90deg, #f0a192, #d9645c)" />
            <Typography.Title level={5} style={{ marginTop: 20 }}>
              谈心谈话类型分布（累计）
            </Typography.Title>
            <MiniBars data={stats.talkByType} color="linear-gradient(90deg, #a9c2ff, #5f86ff)" />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

/**
 * 视口分发：≤768px 走移动端独立渲染层（卡片化 + 触控优化），
 * 桌面端沿用原组件，桌面样式与行为零改动。
 */
export default function Dashboard() {
  const isMobile = useIsMobile();
  return isMobile ? <DashboardMobile /> : <DashboardDesktop />;
}
