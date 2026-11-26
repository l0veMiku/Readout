import { useState } from 'react';
import { AIError, PRESETS, testConnection, validateBaseUrl } from '../lib/ai.ts';
import { loadEndpoint, loadKey, saveConfig } from '../lib/storage.ts';
import type { AIConfig } from '../types.ts';

export function currentConfig(): AIConfig {
  const endpoint = loadEndpoint();
  const preset = PRESETS[0];
  return { baseUrl: endpoint?.baseUrl ?? preset.baseUrl, model: endpoint?.model ?? preset.model, apiKey: loadKey() };
}

export function AISettings({ initial, onSave, onClose }: { initial: AIConfig; onSave: (c: AIConfig) => void; onClose: () => void }) {
  const [config, setConfig] = useState(initial);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [error, setError] = useState('');

  const active = PRESETS.find((p) => p.baseUrl && p.baseUrl === config.baseUrl.replace(/\/+$/, ''))?.id ?? 'custom';

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setConfig((c) => ({ ...c, baseUrl: preset.baseUrl, model: preset.model }));
    setTestResult('');
    setError('');
  };

  const patch = (p: Partial<AIConfig>) => {
    setConfig((c) => ({ ...c, ...p }));
    setTestResult('');
    setError('');
  };

  const test = async () => {
    setError('');
    setTestResult('');
    setTesting(true);
    try {
      validateBaseUrl(config.baseUrl);
      await testConnection(config);
      setTestResult(`连接成功，${config.model} 已回复。`);
    } catch (e) {
      setError(e instanceof AIError ? e.message : '连接失败，请检查配置。');
    } finally {
      setTesting(false);
    }
  };

  const submit = () => {
    if (!config.baseUrl.trim() || !config.model.trim()) return setError('请填写接口地址和模型名。');
    try {
      validateBaseUrl(config.baseUrl);
    } catch (e) {
      return setError(e instanceof AIError ? e.message : '接口地址格式不对。');
    }
    if (!config.apiKey.trim()) return setError('请填写 API Key。');
    const clean = { ...config, baseUrl: config.baseUrl.trim(), model: config.model.trim() };
    saveConfig(clean);
    onSave(clean);
    onClose();
  };

  return (
    <form
      className="ai-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="field">
        <label htmlFor="ai-preset">服务商</label>
        <select id="ai-preset" value={active} onChange={(e) => applyPreset(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </p>
      <p className="field">
        <label htmlFor="ai-base">接口地址（OpenAI 兼容）</label>
        <input id="ai-base" type="text" value={config.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} placeholder="https://api.deepseek.com" autoComplete="off" />
      </p>
      <p className="field">
        <label htmlFor="ai-model">模型名</label>
        <input id="ai-model" type="text" value={config.model} onChange={(e) => patch({ model: e.target.value })} placeholder="deepseek-chat" autoComplete="off" />
      </p>
      <p className="field">
        <label htmlFor="ai-key">API Key</label>
        <input id="ai-key" type="password" value={config.apiKey} onChange={(e) => patch({ apiKey: e.target.value })} placeholder="sk-…" autoComplete="off" />
      </p>
      <p className="hint">
        Key 只保存在当前标签页的会话里，关闭标签页即清除；接口地址和模型名保存在本机浏览器。只有你点击「归纳主题」时，该题的文本回答才会发送到你配置的服务商。接口地址必须使用 https://，本机调试可用 http://localhost。
      </p>
      {error && <p className="alert">{error}</p>}
      {testResult && <p className="ok">{testResult}</p>}
      <footer className="modal-actions">
        <button type="button" className="btn" onClick={test} disabled={testing}>
          {testing ? '正在测试…' : '测试连接'}
        </button>
        <button type="submit" className="btn primary">
          保存
        </button>
      </footer>
    </form>
  );
}
