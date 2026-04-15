import React from 'react';
import { Card, Tag } from 'antd';
import {
  SafetyOutlined,
  BugOutlined,
  LockOutlined,
  AuditOutlined,
  ExperimentOutlined,
  AlertOutlined,
  SecurityScanOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { EvalCategory } from '../services/evalService';

const ICON_MAP: Record<string, React.ReactNode> = {
  safety: <SafetyOutlined />,
  jailbreak: <BugOutlined />,
  privacy: <LockOutlined />,
  compliance: <AuditOutlined />,
  toxicity: <AlertOutlined />,
  robustness: <ThunderboltOutlined />,
  security: <SecurityScanOutlined />,
  default: <ExperimentOutlined />,
};

const PRIORITY_COLORS: Record<number, string> = {
  1: 'red',
  2: 'orange',
  3: 'blue',
  4: 'green',
};

const PRIORITY_LABELS: Record<number, string> = {
  1: '高优先级',
  2: '中优先级',
  3: '标准',
  4: '低优先级',
};

interface EvalCategoryCardProps {
  category: EvalCategory;
  selected: boolean;
  onToggle: (id: string) => void;
}

const EvalCategoryCard: React.FC<EvalCategoryCardProps> = ({
  category,
  selected,
  onToggle,
}) => {
  const icon = ICON_MAP[category.id] || ICON_MAP[category.icon || ''] || ICON_MAP.default;
  const priority = category.priority ?? 3;

  return (
    <Card
      className={`category-card ${selected ? 'category-card-selected' : ''}`}
      onClick={() => onToggle(category.id)}
      hoverable
      size="small"
      bodyStyle={{ padding: 20 }}
    >
      <div className="category-icon" style={{ color: selected ? '#1677ff' : '#666' }}>
        {icon}
      </div>
      <div className="category-name">{category.name}</div>
      <div className="category-desc">{category.description}</div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Tag color={PRIORITY_COLORS[priority]}>{PRIORITY_LABELS[priority]}</Tag>
        {category.taskCount !== undefined && (
          <span style={{ fontSize: 12, color: '#999' }}>
            {category.taskCount} 个测试任务
          </span>
        )}
      </div>
    </Card>
  );
};

export default EvalCategoryCard;
