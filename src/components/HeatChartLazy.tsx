import { useEffect, useRef, useState } from 'react';
import { correlationHeatmap } from '../lib/diagnosticsCharts.ts';
import { Chart } from './Chart.tsx';

// 只在诊断页用到，按路由懒加载。
// 格子保持正方形：先量容器宽度，按宽度分配格子（30–64px），装不下时保持 30px 并横向滚动。
export default function HeatChartLazy({ labels, matrix }: { labels: string[]; matrix: (number | null)[][] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = labels.length;
  const cell = Math.max(30, Math.min(64, Math.floor((width - 100) / Math.max(1, n))));
  const built = width > 0 ? correlationHeatmap(labels, matrix, cell) : null;

  return (
    <>
      <div className="chart-scroll">
        <div ref={wrap}>
          {built ? (
            <div className="heat-inner" style={{ width: built.width }}>
              <Chart option={built.option} height={built.height} width={built.width} />
            </div>
          ) : (
            <p className="chart-placeholder" style={{ height: n * 30 + 30 }}>
              图表加载中…
            </p>
          )}
        </div>
      </div>
      <ol className="heat-legend" aria-label="热图变量编号">
        {labels.map((label, i) => (
          <li key={`${i}-${label}`}>
            <span className="heat-num">{i + 1}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
