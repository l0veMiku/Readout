import { useState } from 'react';
import type { AIResult, Dataset, Question, QuestionType, ScoreForm } from '../types.ts';
import { TYPE_LABELS } from '../types.ts';
import { computeStat, validRowCount } from '../lib/stats.ts';
import type { Stat } from '../lib/stats.ts';
import type { Reliability } from '../lib/reliability.ts';
import type { CleaningSummary } from '../lib/cleaning.ts';
import { scoreNote } from '../lib/scores.ts';
import type { ScoreState } from '../lib/scores.ts';
import type { ScoreMissing } from '../types.ts';
import { includedItems } from '../lib/groups.ts';
import { SCORE_FORM_LABELS } from '../lib/scores.ts';
import type { ReliabilityExtras } from '../lib/reliabilityExtras.ts';
import { FileDrop } from './Home.tsx';
import { GroupCard, OpenText, QuestionCard } from './QuestionView.tsx';
import { Modal } from './Modal.tsx';

interface WorkspaceProps {
  dataset: Dataset;
  stats: Record<string, Stat>;
  findings: string[];
  title: string;
  onTitle: (title: string) => void;
  onChangeType: (id: string, type: QuestionType) => void;
  onToggle: (id: string) => void;
  onMergeQuestions: (ids: string[], title: string) => void;
  onSplitGroup: (id: string) => void;
  onLoad: (file: File) => Promise<void>;
  onDemo: () => Promise<void>;
  aiResults: Record<string, AIResult>;
  hasKey: boolean;
  onOpenSettings: () => void;
  onRun: (q: Question) => Promise<void>;
  reliabilities: Record<string, Reliability | null>;
  onToggleReversed: (id: string) => void;
  rows: Record<string, string>[];
  cleaning: CleaningSummary | null;
  onOpenCleaning: () => void;
  scoreStates: ScoreState[];
  onScore: (groupId: string, missing: ScoreMissing | null) => void;
  // 专业模式：各题组的信度扩展，以及得分形式的选择。
  extras: Record<string, ReliabilityExtras | null>;
  onScoreForm: (groupId: string, form: ScoreForm) => void;
  scoreFormsEnabled: boolean;
}

export function Workspace({ dataset, stats, findings, title, onTitle, onChangeType, onToggle, onMergeQuestions, onSplitGroup, onLoad, onDemo, aiResults, hasKey, onOpenSettings, onRun, reliabilities, extras, onToggleReversed, rows, cleaning, onOpenCleaning, scoreStates, onScore, onScoreForm, scoreFormsEnabled }: WorkspaceProps) {
  const [navOpen, setNavOpen] = useState(false);
  const [error, setError] = useState('');
  const [mergeFrom, setMergeFrom] = useState<Question | null>(null);
  const included = dataset.questions.filter((q) => q.included);
  const items = includedItems(dataset);
  const ignored = dataset.questions.filter((q) => !q.included);
  const openQuestions = included.filter((q) => q.type === 'open');
  const openAnswers = openQuestions.reduce((s, q) => s + (stats[q.id]?.n ?? 0), 0);
  const aiDone = openQuestions.filter((q) => aiResults[q.id]).length;
  const groupCount = items.filter((item) => item.kind === 'group').length;
  const scoreCount = scoreStates.filter((s) => s.missing).length;

  const jump = (i: number) => {
    setNavOpen(false);
    document.getElementById(`card-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="workspace">
      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <p className="side-label">题目目录</p>
        <ol className="side-list">
          {items.map((item, i) =>
            item.kind === 'group' ? (
              <li key={item.group.id} className="side-group">
                <button onClick={() => jump(i)}>
                  <span className="dot dot-group" />
                  <span className="side-title">{item.group.title}</span>
                  <span className="side-type">题组</span>
                </button>
                <ol className="side-sub">
                  {item.questions.map((q) => (
                    <li key={q.id}>
                      <button onClick={() => jump(i)}>
                        <span className="side-title">{q.subTitle ?? q.title}</span>
                        <span className="side-type">{TYPE_LABELS[q.type]}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </li>
            ) : (
              <li key={item.question.id}>
                <button onClick={() => jump(i)}>
                  <span className={`dot dot-${item.question.type}`} />
                  <span className="side-title">{item.question.title}</span>
                  <span className="side-type">{TYPE_LABELS[item.question.type]}</span>
                </button>
              </li>
            ),
          )}
        </ol>
        {ignored.length > 0 && (
          <details className="side-ignored">
            <summary>未纳入分析的列 · {ignored.length}</summary>
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
            {dataset.rows.length} 份问卷 · {included.length} 道题纳入分析
            {groupCount > 0 ? `（${groupCount} 个题组${scoreCount > 0 ? `，${scoreCount} 个维度得分` : ''}）` : ''} · {validRowCount(dataset, rows)} 份有效
            {cleaning && cleaning.excluded > 0 ? `（已剔除 ${cleaning.excluded} 份）` : ''} · {dataset.fileName}
            {dataset.sheet ? ` · 工作表「${dataset.sheet}」` : ''}
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
            <button className="btn" onClick={onOpenCleaning}>
              数据清洗{cleaning && cleaning.excluded + cleaning.flagged > 0 ? `（剔除 ${cleaning.excluded}${cleaning.flagged > 0 ? `，标记 ${cleaning.flagged}` : ''}）` : ''}
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
            ['有效样本', String(validRowCount(dataset, rows)), cleaning && cleaning.excluded > 0 ? `回收 ${dataset.rows.length} 份，剔除 ${cleaning.excluded} 份` : `共 ${dataset.rows.length} 份`],
            ['纳入题目', String(included.length), `已忽略 ${ignored.length} 道${scoreCount > 0 ? ` · 含 ${scoreCount} 个维度得分` : ''}`],
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
          {items.map((item, i) =>
            item.kind === 'group' ? (
              <GroupCard
                key={item.group.id}
                index={i}
                group={item.group}
                questions={item.questions}
                stats={stats}
                reliability={reliabilities[item.group.id] ?? null}
                onToggleReversed={onToggleReversed}
                onChangeType={(type) => item.questions.forEach((q) => onChangeType(q.id, type))}
                onIgnore={() => onToggle(item.questions[0].id)}
                onSplit={() => onSplitGroup(item.group.id)}
                score={scoreStates.find((s) => s.group.id === item.group.id)}
                onScore={onScore}
                extras={extras[item.group.id] ?? null}
              />
            ) : (
              <QuestionCard
                key={item.question.id}
                index={i}
                question={item.question}
                stat={stats[item.question.id] ?? computeStat(item.question, rows)}
                locked={!!item.question.derived}
                onRemove={item.question.derived ? () => onScore(item.question.derived!.groupId, null) : undefined}
                note={item.question.derived ? scoreNote(item.question, dataset) : undefined}
                onChangeType={(type) => onChangeType(item.question.id, type)}
                onIgnore={() => onToggle(item.question.id)}
                onMerge={item.question.derived ? undefined : () => setMergeFrom(item.question)}
              >
                {item.question.type === 'open' && (
                  <OpenText question={item.question} stat={stats[item.question.id]} result={aiResults[item.question.id]} hasKey={hasKey} onOpenSettings={onOpenSettings} onRun={onRun} />
                )}
                {item.question.derived && scoreFormsEnabled && (
                  <label className="inline score-form">
                    得分形式
                    <select value={dataset.scoreForms?.[item.question.derived.groupId] ?? 'mean'} onChange={(e) => onScoreForm(item.question.derived!.groupId, e.target.value as ScoreForm)}>
                      {(Object.keys(SCORE_FORM_LABELS) as ScoreForm[]).map((form) => (
                        <option key={form} value={form}>
                          {SCORE_FORM_LABELS[form]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </QuestionCard>
            ),
          )}
        </div>
        {included.length === 0 && <p className="empty">所有题目都被忽略了，在左侧「未纳入分析的列」里可以恢复。</p>}
      </main>

      {mergeFrom && (
        <Modal title="合并为题组" onClose={() => setMergeFrom(null)}>
          <MergeForm
            source={mergeFrom}
            candidates={included.filter((q) => q.id !== mergeFrom.id && !q.derived)}
            onCancel={() => setMergeFrom(null)}
            onConfirm={(ids, name) => {
              onMergeQuestions(ids, name);
              setMergeFrom(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function MergeForm({ source, candidates, onCancel, onConfirm }: { source: Question; candidates: Question[]; onCancel: () => void; onConfirm: (ids: string[], title: string) => void }) {
  const [selected, setSelected] = useState<string[]>([source.id]);
  const [title, setTitle] = useState('');
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <form
      className="ai-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (selected.length >= 2) onConfirm(selected, title || source.title);
      }}
    >
      <label className="field">
        <span>题组名称</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={source.title} />
      </label>
      <div className="field">
        <span>选择要并入的题目（至少 2 道）</span>
        <div className="merge-list">
          <label className="merge-item">
            <input type="checkbox" checked disabled />
            <span>{source.title}</span>
            <small>{TYPE_LABELS[source.type]}</small>
          </label>
          {candidates.map((q) => (
            <label key={q.id} className="merge-item">
              <input type="checkbox" checked={selected.includes(q.id)} onChange={() => toggle(q.id)} />
              <span>{q.title}</span>
              <small>{TYPE_LABELS[q.type]}</small>
            </label>
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>
          取消
        </button>
        <button className="btn primary" disabled={selected.length < 2}>
          合并
        </button>
      </div>
    </form>
  );
}
