import { useState } from 'react';
import type { AIResult, Dataset, Question, QuestionType } from '../types.ts';
import { TYPE_LABELS } from '../types.ts';
import { computeStat, validRowCount } from '../lib/stats.ts';
import type { Stat } from '../lib/stats.ts';
import { FileDrop } from './Home.tsx';
import { OpenText, QuestionCard } from './QuestionView.tsx';

interface WorkspaceProps {
  dataset: Dataset;
  stats: Record<string, Stat>;
  findings: string[];
  title: string;
  onTitle: (title: string) => void;
  onChangeType: (id: string, type: QuestionType) => void;
  onToggle: (id: string) => void;
  onLoad: (file: File) => Promise<void>;
  onDemo: () => Promise<void>;
  aiResults: Record<string, AIResult>;
  hasKey: boolean;
  onOpenSettings: () => void;
  onRun: (q: Question) => Promise<void>;
}

export function Workspace({ dataset, stats, findings, title, onTitle, onChangeType, onToggle, onLoad, onDemo, aiResults, hasKey, onOpenSettings, onRun }: WorkspaceProps) {
  const [navOpen, setNavOpen] = useState(false);
  const [error, setError] = useState('');
  const included = dataset.questions.filter((q) => q.included);
  const ignored = dataset.questions.filter((q) => !q.included);
  const openQuestions = included.filter((q) => q.type === 'open');
  const openAnswers = openQuestions.reduce((s, q) => s + (stats[q.id]?.n ?? 0), 0);
  const aiDone = openQuestions.filter((q) => aiResults[q.id]).length;

  const jump = (i: number) => {
    setNavOpen(false);
    document.getElementById(`card-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="workspace">
      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <p className="side-label">题目目录</p>
        <ol className="side-list">
          {included.map((q, i) => (
            <li key={q.id}>
              <button onClick={() => jump(i)}>
                <span className={`dot dot-${q.type}`} />
                <span className="side-title">{q.title}</span>
                <span className="side-type">{TYPE_LABELS[q.type]}</span>
              </button>
            </li>
          ))}
        </ol>
        {ignored.length > 0 && (
          <details className="side-ignored">
            <summary>已忽略的题目 · {ignored.length}</summary>
            <ul>
              {ignored.map((q) => (
                <li key={q.id}>
                  <span>{q.title}</span>
                  <button className="link" onClick={() => onToggle(q.id)}>
                    恢复
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </aside>

      <main className="work-main">
        <header className="work-head">
          <button className="btn small nav-toggle" onClick={() => setNavOpen((v) => !v)}>
            题目目录
          </button>
          <input className="report-title" value={title} onChange={(e) => onTitle(e.target.value)} aria-label="报告标题" spellCheck={false} />
          <p className="work-meta">
            {dataset.rows.length} 份问卷 · {included.length} 道题纳入分析 · {validRowCount(dataset)} 份有效 · {dataset.fileName}
            {dataset.skippedRows > 0 ? ` · 已跳过表头上方 ${dataset.skippedRows} 行` : ''}
          </p>
          <div className="work-actions">
            <FileDrop
              compact
              onLoad={onLoad}
              onError={(msg) => setError(msg)}
            />
            <button
              className="btn"
              onClick={() => {
                setError('');
                onDemo().catch((e) => setError(e instanceof Error ? e.message : '示例数据加载失败。'));
              }}
            >
              载入示例
            </button>
          </div>
          {error && <p className="alert">{error}</p>}
        </header>

        <section className="card findings">
          <h2>关键发现</h2>
          {findings.length ? (
            <ol>
              {findings.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ol>
          ) : (
            <p className="empty">还没有可汇总的题目。把题型改成单选、量表或数值后，这里会自动生成结论。</p>
          )}
        </section>

        <section className="stat-cards">
          {[
            ['有效样本', String(validRowCount(dataset)), `共 ${dataset.rows.length} 份`],
            ['纳入题目', String(included.length), `已忽略 ${ignored.length} 道`],
            ['开放题回答', String(openAnswers), `${openQuestions.length} 道开放题`],
            ['AI 已归纳', String(aiDone), aiDone ? `共 ${openQuestions.length} 道开放题` : '需要配置模型'],
          ].map(([k, v, note]) => (
            <div className="stat-card" key={k}>
              <span>{k}</span>
              <b>{v}</b>
              <small>{note}</small>
            </div>
          ))}
        </section>

        <h2 className="section-label">逐题分析</h2>
        <div className="cards">
          {included.map((q, i) => (
            <QuestionCard
              key={q.id}
              index={i}
              question={q}
              stat={stats[q.id] ?? computeStat(q, dataset.rows)}
              onChangeType={(type) => onChangeType(q.id, type)}
              onIgnore={() => onToggle(q.id)}
            >
              {q.type === 'open' && (
                <OpenText question={q} stat={stats[q.id]} result={aiResults[q.id]} hasKey={hasKey} onOpenSettings={onOpenSettings} onRun={onRun} />
              )}
            </QuestionCard>
          ))}
        </div>
        {included.length === 0 && <p className="empty">所有题目都被忽略了，在左侧「已忽略的题目」里可以恢复。</p>}
      </main>
    </div>
  );
}
