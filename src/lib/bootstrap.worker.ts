import { bootstrapIntervals } from './intervals.ts';

// 后台线程只做一件事：对一列数值重抽样。区间算法与主线程共用同一份实现和随机种子。
type WorkerScope = { onmessage: ((e: MessageEvent<number[]>) => void) | null; postMessage(data: unknown): void };
const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (e) => scope.postMessage(bootstrapIntervals(e.data));
