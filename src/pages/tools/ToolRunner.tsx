import { Card, Empty, Tag } from 'antd';
import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

import PageHeader from '@/components/PageHeader';
import { TOOLS } from '@/pages/tools/registry';

/**
 * 当前工作台主题（接入全局暗色主题后只需翻转此值，
 * 内嵌工具通过 postMessage / URL 参数实时跟随切换）。
 */
const WORKBENCH_THEME: 'light' | 'dark' = 'light';

/** 工具运行页：以 iframe 内嵌注册表中的工具页面，自适应容器并内部滚动 */
export default function ToolRunner() {
  const { toolKey } = useParams<{ toolKey: string }>();
  const tool = TOOLS.find((t) => t.key === toolKey);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const postTheme = () => {
    frameRef.current?.contentWindow?.postMessage(
      { type: 'tool-theme', theme: WORKBENCH_THEME },
      '*',
    );
  };

  useEffect(() => {
    postTheme();
    // 工具切换后重新同步主题（iframe onLoad 也会触发一次）
  }, [toolKey]);

  if (!tool) {
    return (
      <div className="page">
        <Card>
          <Empty description="未找到该工具，请从「实用工具」广场重新进入" />
        </Card>
      </div>
    );
  }

  const Icon = tool.icon;

  return (
    <div className="page">
      <PageHeader
        title={tool.title}
        subtitle={tool.description}
        extra={
          <span>
            {tool.tags.map((tag) => (
              <Tag key={tag} color="blue" style={{ marginInlineEnd: 0, marginLeft: 6 }}>
                <Icon style={{ marginRight: 4 }} />
                {tag}
              </Tag>
            ))}
          </span>
        }
      />
      <Card className="tool-frame-card" styles={{ body: { padding: 8 } }}>
        <iframe
          key={tool.key}
          ref={frameRef}
          className="tool-iframe"
          src={`${tool.embedUrl}?theme=${WORKBENCH_THEME}`}
          title={tool.title}
          onLoad={postTheme}
        />
      </Card>
    </div>
  );
}
