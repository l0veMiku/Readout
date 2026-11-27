import { bootstrapIntervals } from './intervals.ts';
import type { BootIntervals } from './intervals.ts';

interface Job {
  values: number[];
  done: (result: BootIntervals) => void;
}

const MAX_WORKERS = 8;

// 数值题的 Bootstrap 放进 Web Worker：主线程先画表格和图表，区间算完再补上。
// 按 CPU 核数开多个 Worker 并行；Worker 起不来时退回主线程，放到下一拍再算，首屏仍然先出。
class BootstrapPool {
  private readonly size = Math.min(MAX_WORKERS, Math.max(1, navigator.hardwareConcurrency || 1));
  private readonly idle: Worker[] = [];
  private readonly running = new Map<Worker, Job>();
  private queue: Job[] = [];
  private broken = false;

  // 算完回调一次，不返回 Promise；回调总会触发，Worker 不可用时由池子转回主线程。
  run(values: number[], done: (result: BootIntervals) => void): void {
    const job = { values, done };
    this.queue.push(job);
    if (this.broken) this.useMainThread();
    else this.pump();
  }

  private pump() {
    while (this.queue.length > 0 && !this.broken) {
      if (this.idle.length === 0 && this.running.size >= this.size) return;
      const worker = this.idle.pop() ?? this.spawn();
      // spawn 失败时队列已被转到主线程，这里直接退出。
      if (!worker) return;
      const job = this.queue.shift()!;
      this.running.set(worker, job);
      worker.postMessage(job.values);
    }
  }

  private spawn(): Worker | null {
    try {
      const worker = new Worker(new URL('./bootstrap.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<BootIntervals>) => {
        const job = this.running.get(worker);
        this.running.delete(worker);
        this.idle.push(worker);
        job?.done(e.data);
        this.pump();
      };
      // 脚本加载失败或 Worker 内部抛错：整体退回主线程，已提交的任务照常算完。
      worker.onerror = () => this.useMainThread();
      return worker;
    } catch {
      this.useMainThread();
      return null;
    }
  }

  private useMainThread() {
    // 已损坏时队列里只会有 run() 刚放进来的任务，照常转移。
    this.broken = true;
    for (const worker of this.running.keys()) worker.terminate();
    for (const job of [...this.running.values(), ...this.queue]) setTimeout(() => job.done(bootstrapIntervals(job.values)), 0);
    this.running.clear();
    this.queue = [];
  }
}

export const bootstrapPool = new BootstrapPool();
