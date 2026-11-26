import type { AIConfig } from '../types.ts';

const ENDPOINT_KEY = 'readout.endpoint';
const KEY_KEY = 'readout.key';

export interface Endpoint {
  baseUrl: string;
  model: string;
}

export function loadEndpoint(): Endpoint | null {
  try {
    const raw = localStorage.getItem(ENDPOINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Endpoint> | null;
    if (typeof parsed?.baseUrl === 'string' && typeof parsed.model === 'string') return { baseUrl: parsed.baseUrl, model: parsed.model };
  } catch {
    /* 存储不可用时按未配置处理 */
  }
  return null;
}

export function loadKey() {
  try {
    return sessionStorage.getItem(KEY_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveConfig(config: AIConfig) {
  try {
    localStorage.setItem(ENDPOINT_KEY, JSON.stringify({ baseUrl: config.baseUrl, model: config.model }));
  } catch {
    /* 忽略：仅本次会话内可用 */
  }
  try {
    if (config.apiKey) sessionStorage.setItem(KEY_KEY, config.apiKey);
    else sessionStorage.removeItem(KEY_KEY);
  } catch {
    /* 忽略 */
  }
}
