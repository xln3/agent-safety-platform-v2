import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';

interface RadarDataItem {
  benchmark: string;
  score: number;
}

interface EvalRadarChartProps {
  data: RadarDataItem[];
  height?: number;
  seriesName?: string;
}

const EvalRadarChart: React.FC<EvalRadarChartProps> = ({
  data,
  height = 400,
  seriesName = '安全评分',
}) => {
  const option: EChartsOption = useMemo(() => {
    if (!data || data.length === 0) {
      return {};
    }

    const indicators = data.map((item) => ({
      name: item.benchmark,
      max: 100,
    }));

    const values = data.map((item) => item.score);

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          if (!params?.value) return '';
          const lines = data.map(
            (d, i) => `${d.benchmark}: <b>${Math.round(params.value[i])}</b>`,
          );
          return lines.join('<br/>');
        },
      },
      radar: {
        indicator: indicators,
        shape: 'polygon',
        radius: '65%',
        axisName: {
          color: '#555',
          fontSize: 12,
          fontWeight: 500,
        },
        splitArea: {
          areaStyle: {
            color: ['#fff', '#f9fafb', '#fff', '#f9fafb', '#fff'],
          },
        },
        splitLine: {
          lineStyle: {
            color: '#e5e7eb',
          },
        },
        axisLine: {
          lineStyle: {
            color: '#e5e7eb',
          },
        },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: values,
              name: seriesName,
              symbol: 'circle',
              symbolSize: 7,
              lineStyle: {
                width: 2,
                color: '#3b82f6',
              },
              areaStyle: {
                color: 'rgba(59, 130, 246, 0.15)',
              },
              itemStyle: {
                color: '#3b82f6',
              },
              label: {
                show: true,
                formatter: (p: any) => String(Math.round(p.value)),
                fontSize: 11,
                color: '#666',
              },
            },
          ],
        },
      ],
    };
  }, [data, seriesName]);

  if (!data || data.length === 0) {
    return (
      <div className="flex-center" style={{ height, color: '#999' }}>
        暂无评估数据
      </div>
    );
  }

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );
};

export default EvalRadarChart;
