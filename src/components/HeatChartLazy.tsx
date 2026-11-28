import { correlationHeatmap } from '../lib/diagnosticsCharts.ts';
import { Chart } from './Chart.tsx';

// 只在诊断页用到，按路由懒加载；宽度按正方形格子算，超宽时容器横向滚动。
export default function HeatChartLazy({ labels, matrix }: { labels: string[]; matrix: (number | null)[][] }) {
  const built = correlationHeatmap(labels, matrix);
  return (
    <div className="chart-scroll">
      <Chart option={built.option} height={built.height} width={built.width} />
    </div>
  );
}
