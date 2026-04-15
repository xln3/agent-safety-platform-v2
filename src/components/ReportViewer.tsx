import React, { useRef } from 'react';
import { Card, Button, Space } from 'antd';
import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons';

interface ReportViewerProps {
  content: string;
  title?: string;
}

const ReportViewer: React.FC<ReportViewerProps> = ({ content, title }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${title || '评估报告'}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; line-height: 1.8; color: #333; }
    h1, h2, h3 { margin: 16px 0 8px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
  </style>
</head>
<body>
${content}
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title || 'report'}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Card
      title={title ? `报告内容 - ${title}` : '报告内容'}
      extra={
        <Space className="no-print">
          <Button icon={<DownloadOutlined />} onClick={handleDownload}>
            下载
          </Button>
          <Button icon={<PrinterOutlined />} onClick={handlePrint}>
            打印
          </Button>
        </Space>
      }
    >
      <div
        ref={containerRef}
        className="report-viewer-container"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </Card>
  );
};

export default ReportViewer;
