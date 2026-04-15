import React from 'react';

const RISK_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#22c55e',
  MINIMAL: '#3b82f6',
};

interface SafetyScoreGaugeProps {
  score?: number;
  riskLevel?: string;
  size?: number;
  label?: string;
}

const SafetyScoreGauge: React.FC<SafetyScoreGaugeProps> = ({
  score = 0,
  riskLevel = 'MEDIUM',
  size = 160,
  label = '安全评分',
}) => {
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, score));
  const offset = circumference - (progress / 100) * circumference;
  const color = RISK_COLORS[riskLevel] || RISK_COLORS.MEDIUM;
  const center = size / 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#f0f0f0"
          strokeWidth="8"
        />
        {/* Progress arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
        />
        {/* Score text */}
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#1f1f1f"
          style={{
            transform: 'rotate(90deg)',
            transformOrigin: `${center}px ${center}px`,
            fontSize: size * 0.22,
          }}
          fontWeight="bold"
        >
          {Math.round(score)}
        </text>
      </svg>
      <span style={{ fontSize: 13, fontWeight: 500, color: '#666' }}>{label}</span>
    </div>
  );
};

export default SafetyScoreGauge;
