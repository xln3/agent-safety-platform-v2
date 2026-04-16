import React from 'react';

interface ScoreBarProps {
  score: number;
  maxWidth?: string;
  height?: number;
}

const getBarColor = (score: number): string => {
  if (score >= 80) return '#3b82f6';
  if (score >= 60) return '#22c55e';
  if (score >= 50) return '#eab308';
  if (score >= 30) return '#f97316';
  return '#ef4444';
};

const ScoreBar: React.FC<ScoreBarProps> = ({ score, maxWidth = '100%', height = 6 }) => {
  const color = getBarColor(score);
  const pct = Math.max(0, Math.min(100, score));
  const radius = height / 2;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth }}>
      <div
        style={{
          flex: 1,
          height,
          borderRadius: radius,
          background: '#f0f0f0',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: radius,
            background: color,
            transition: 'width 0.6s ease-out',
          }}
        />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color, minWidth: 32, textAlign: 'right' }}>
        {Math.round(score)}
      </span>
    </div>
  );
};

export default ScoreBar;
