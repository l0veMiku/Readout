import * as echarts from 'echarts/core';
import { useEffect, useRef } from 'react';
import type { ChartOption } from '../lib/charts.ts';

export function Chart({ option, height, width }: { option: ChartOption; height: number; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const instance = echarts.init(el, undefined, { renderer: 'svg' });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(el);
    // 打印前浏览器会切换版式，图表需要按打印宽度重排一次。
    const media = window.matchMedia('print');
    const resize = () => instance.resize();
    media.addEventListener('change', resize);
    window.addEventListener('beforeprint', resize);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', resize);
      window.removeEventListener('beforeprint', resize);
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} className="chart" style={{ height, ...(width ? { width } : {}) }} />;
}
