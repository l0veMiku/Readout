import { boxplots } from '../lib/diagnosticsCharts.ts';
import type { BoxRow } from '../lib/diagnosticsCharts.ts';
import { Chart } from './Chart.tsx';

// 只在诊断页用到，按路由懒加载（见 lib/diagnosticsCharts.ts 的说明）。
export default function BoxChartLazy({ rows }: { rows: BoxRow[] }) {
  const built = boxplots(rows);
  return <Chart option={built.option} height={built.height} />;
}
