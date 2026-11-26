import { useState } from 'react';
import { ParseError, SUPPORTED_EXTENSIONS } from '../lib/parse.ts';

interface HomeProps {
  onLoad: (file: File) => Promise<void>;
  onDemo: () => Promise<void>;
  resumeTitle?: string;
  onResume?: () => void;
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1f5e46" />
      <rect x="7" y="16" width="4" height="9" rx="1" fill="#f4efe6" />
      <rect x="14" y="11" width="4" height="14" rx="1" fill="#f4efe6" />
      <rect x="21" y="7" width="4" height="18" rx="1" fill="#f4efe6" />
    </svg>
  );
}

export function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button className="brand" onClick={onClick} aria-label="回到首页">
      <Logo />
      <b>Readout</b>
      <span className="brand-sub">问卷读数</span>
    </button>
  );
}

interface FileDropProps {
  onLoad: (file: File) => Promise<void>;
  onError: (msg: string) => void;
  compact?: boolean;
}

export function FileDrop({ onLoad, onError, compact }: FileDropProps) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await onLoad(file);
    } catch (e) {
      onError(e instanceof ParseError ? e.message : `读取失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <label
      className={`dropzone${dragging ? ' dragging' : ''}${compact ? ' compact' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handle(e.dataTransfer.files[0]);
      }}
    >
      <input
        type="file"
        accept={SUPPORTED_EXTENSIONS.map((x) => `.${x}`).join(',')}
        onChange={(e) => {
          void handle(e.target.files?.[0]);
          e.target.value = '';
        }}
        disabled={busy}
      />
      <span className={compact ? 'btn' : 'btn primary'}>{busy ? '正在读取…' : compact ? '换一份文件' : '选择问卷文件'}</span>
      {!compact && <span className="drop-hint">支持 .xlsx / .xls / .csv，最多 2 万行 · 也可以把文件拖到这里</span>}
    </label>
  );
}

export function Home({ onLoad, onDemo, resumeTitle, onResume }: HomeProps) {
  const [error, setError] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);

  const loadDemo = async () => {
    setError('');
    setDemoBusy(true);
    try {
      await onDemo();
    } catch (e) {
      setError(e instanceof Error ? e.message : '示例数据加载失败。');
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <main className="home">
      <div className="home-brand">
        <Logo size={34} />
        <b>Readout</b>
        <span>问卷读数</span>
      </div>

      <section className="hero">
        <h1>
          把问卷导出的 Excel，
          <br />
          变成一份能直接分享的分析报告。
        </h1>
        <p className="lede">
          上传问卷星、腾讯问卷导出的文件，自动识别题型、生成图表，用你自己的模型归纳开放题。
          <br />
          全程在浏览器里完成，文件不上传，不需要登录。
        </p>

        <FileDrop onLoad={onLoad} onError={setError} />
        <button className="link demo-link" onClick={() => void loadDemo()} disabled={demoBusy}>
          {demoBusy ? '正在加载…' : '先看看示例数据：128 份「大学生 AI 工具使用调查」→'}
        </button>
        {error && <p className="alert home-alert">{error}</p>}
        {resumeTitle && onResume && (
          <p className="resume">
            上一份文件还在内存里：
            <button className="link" onClick={onResume}>
              返回「{resumeTitle}」→
            </button>
          </p>
        )}
      </section>

      <ul className="points">
        <li>
          <b>自动识题型</b>
          <span>单选、多选、量表、数值、开放题，可随时手动改。</span>
        </li>
        <li>
          <b>图表与关键发现</b>
          <span>频数、分布、均值，开头就是能写进汇报的结论。</span>
        </li>
        <li>
          <b>AI 读开放题</b>
          <span>归纳主题并保留原文引用，用自己的 Key。</span>
        </li>
        <li>
          <b>一键成报告</b>
          <span>A4 排版，打印或另存为 PDF。</span>
        </li>
      </ul>

      <footer className="home-foot">本地优先 · 开源 MIT · 刷新页面即清除数据</footer>
    </main>
  );
}
