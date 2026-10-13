import { RightOutlined } from '@ant-design/icons';
import { Card, Col, Row, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';

import PageHeader from '@/components/PageHeader';
import { TOOL_INDEX_ICON, TOOLS } from '@/pages/tools/registry';

/** 实用工具广场：自研小工具的统一入口（卡片由注册表驱动，自动扩展） */
export default function ToolsIndex() {
  const navigate = useNavigate();
  const HubIcon = TOOL_INDEX_ICON;

  return (
    <div className="page">
      <PageHeader
        title="实用工具"
        subtitle="自研小工具统一入口，持续上新"
        extra={
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            <HubIcon style={{ marginRight: 6 }} />
            {TOOLS.length} 个工具
          </Tag>
        }
      />

      <Row gutter={[16, 16]}>
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <Col xs={24} sm={12} xl={8} key={tool.key}>
              <Card
                className="tool-entry-card"
                hoverable
                onClick={() => navigate(tool.path)}
              >
                <div className="tool-entry-top">
                  <div className="tool-entry-icon">
                    <Icon />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="tool-entry-title">{tool.title}</div>
                    <div className="tool-entry-tags">
                      {tool.tags.map((tag) => (
                        <Tag key={tag} style={{ marginInlineEnd: 0 }}>
                          {tag}
                        </Tag>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="tool-entry-desc">{tool.description}</div>
                <div className="tool-entry-foot">
                  <span>内嵌运行 · 无需跳转外部</span>
                  <span className="tool-entry-open">
                    打开工具 <RightOutlined />
                  </span>
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
