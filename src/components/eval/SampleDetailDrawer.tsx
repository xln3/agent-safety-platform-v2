import React, { useEffect, useState } from 'react';
import { Drawer, Descriptions, Tag, Typography, Spin, Empty, Divider, Space } from 'antd';
import { evalService } from '../../services/evalService';
import type { EvalItem } from '../../services/evalService';
import dayjs from 'dayjs';

const { Text, Paragraph } = Typography;

interface Props {
  jobId: number;
  itemId: number | null;
  open: boolean;
  onClose: () => void;
}

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '等待中' },
  running: { color: 'processing', label: '运行中' },
  success: { color: 'success', label: '成功' },
  failed: { color: 'error', label: '失败' },
};

const formatDate = (d: string | null) =>
  d ? dayjs(d).format('YYYY-MM-DD HH:mm:ss') : '-';

const SampleDetailDrawer: React.FC<Props> = ({ jobId, itemId, open, onClose }) => {
  const [item, setItem] = useState<EvalItem | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !itemId) return;
    setLoading(true);
    setItem(null);
    evalService
      .getJobItem(jobId, itemId)
      .then((data) => setItem(data as EvalItem))
      .catch(() => setItem(null))
      .finally(() => setLoading(false));
  }, [jobId, itemId, open]);

  const tag = item ? STATUS_TAG[item.status] || STATUS_TAG.pending : null;
  const inputJson = item?.inputJson as Record<string, any> | null;
  const inputText =
    typeof inputJson?.input === 'string'
      ? inputJson.input
      : inputJson
        ? JSON.stringify(inputJson, null, 2)
        : '';

  return (
    <Drawer
      title="样本详情"
      placement="right"
      open={open}
      onClose={onClose}
      width={720}
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : !item ? (
        <Empty description="未找到样本" />
      ) : (
        <div>
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="状态">
              {tag && <Tag color={tag.color}>{tag.label}</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="样本 ID">
              <Text code copyable>
                {item.sampleId}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="基准">{item.benchmark}</Descriptions.Item>
            <Descriptions.Item label="任务 ID">{item.taskId}</Descriptions.Item>
            <Descriptions.Item label="耗时">
              {item.latencyMs != null ? `${item.latencyMs} ms` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="重试次数">{item.retryCount ?? 0}</Descriptions.Item>
            <Descriptions.Item label="开始时间">{formatDate(item.startedAt)}</Descriptions.Item>
            <Descriptions.Item label="完成时间">{formatDate(item.finishedAt)}</Descriptions.Item>
            {item.score != null && (
              <Descriptions.Item label="分数" span={2}>
                <Space>
                  <Text strong>{item.score.toFixed(2)}</Text>
                  {item.scoreLabel && <Tag>{item.scoreLabel}</Tag>}
                </Space>
              </Descriptions.Item>
            )}
          </Descriptions>

          <Divider titlePlacement="start">输入</Divider>
          <Paragraph
            style={{
              whiteSpace: 'pre-wrap',
              background: '#fafafa',
              padding: 12,
              borderRadius: 6,
              maxHeight: 280,
              overflow: 'auto',
              marginBottom: 16,
            }}
          >
            {inputText || <Text type="secondary">无输入数据</Text>}
          </Paragraph>

          <Divider titlePlacement="start">模型输出</Divider>
          <Paragraph
            style={{
              whiteSpace: 'pre-wrap',
              background: item.status === 'failed' ? '#fff2f0' : '#f0f9eb',
              padding: 12,
              borderRadius: 6,
              maxHeight: 360,
              overflow: 'auto',
              marginBottom: 16,
            }}
          >
            {item.outputText || <Text type="secondary">尚无输出</Text>}
          </Paragraph>

          {item.toolCallsJson && item.toolCallsJson.length > 0 && (
            <>
              <Divider titlePlacement="start">
                工具调用 (tool_calls)
                <Tag style={{ marginLeft: 8 }} color="blue">
                  {item.toolCallsJson.length}
                </Tag>
              </Divider>
              <div style={{ marginBottom: 16 }}>
                {item.toolCallsJson.map((tc, idx) => {
                  const source =
                    (tc.metadata && (tc.metadata as any).source) || 'native';
                  return (
                    <div
                      key={tc.id || `${tc.name}-${idx}`}
                      style={{
                        background: '#f0f5ff',
                        border: '1px solid #adc6ff',
                        borderRadius: 6,
                        padding: 12,
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ marginBottom: 4 }}>
                        <Text strong>#{idx + 1}</Text>
                        <Text code style={{ marginLeft: 8 }}>
                          {tc.name}
                        </Text>
                        <Tag style={{ marginLeft: 8 }} color="geekblue">
                          {source}
                        </Tag>
                      </div>
                      <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                        参数 (arguments):
                      </div>
                      <Paragraph
                        style={{
                          whiteSpace: 'pre-wrap',
                          background: '#fff',
                          padding: 8,
                          borderRadius: 4,
                          marginBottom: tc.result ? 8 : 0,
                          fontSize: 12,
                          fontFamily: 'monospace',
                        }}
                      >
                        {tc.arguments || '{}'}
                      </Paragraph>
                      {tc.result && (
                        <>
                          <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                            结果 (result):
                          </div>
                          <Paragraph
                            style={{
                              whiteSpace: 'pre-wrap',
                              background: '#fff',
                              padding: 8,
                              borderRadius: 4,
                              marginBottom: 0,
                              fontSize: 12,
                              fontFamily: 'monospace',
                            }}
                          >
                            {tc.result}
                          </Paragraph>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {item.errorMessage && (
            <>
              <Divider titlePlacement="start">错误信息</Divider>
              <Paragraph
                type="danger"
                style={{
                  whiteSpace: 'pre-wrap',
                  background: '#fff2f0',
                  padding: 12,
                  borderRadius: 6,
                  maxHeight: 200,
                  overflow: 'auto',
                  marginBottom: 16,
                }}
              >
                {item.errorMessage}
              </Paragraph>
            </>
          )}

          {item.judgeRationale && (
            <>
              <Divider titlePlacement="start">评分理由</Divider>
              <Paragraph
                style={{
                  whiteSpace: 'pre-wrap',
                  background: '#f5f5f5',
                  padding: 12,
                  borderRadius: 6,
                  maxHeight: 200,
                  overflow: 'auto',
                  marginBottom: 16,
                }}
              >
                {item.judgeRationale}
              </Paragraph>
            </>
          )}

          {inputJson?.metadata && Object.keys(inputJson.metadata).length > 0 && (
            <>
              <Divider titlePlacement="start">元数据</Divider>
              <Paragraph
                style={{
                  whiteSpace: 'pre-wrap',
                  background: '#f5f5f5',
                  padding: 12,
                  borderRadius: 6,
                  fontSize: 12,
                  marginBottom: 16,
                }}
              >
                {JSON.stringify(inputJson.metadata, null, 2)}
              </Paragraph>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
};

export default SampleDetailDrawer;
