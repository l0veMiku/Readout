import { useEffect, useMemo, useRef, useState } from 'react';
import { Brand, Home } from './components/Home.tsx';
import { Workspace } from './components/Workspace.tsx';
import { Report } from './components/Report.tsx';
import { ComparePage, comparisonFor, pickStillValid } from './components/Compare.tsx';
import type { ComparisonPick } from './components/Compare.tsx';
import { Modal } from './components/Modal.tsx';
import { AISettings, currentConfig } from './components/AISettings.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { parseFile } from './lib/parse.ts';
import { buildFindings, computeStat, numericSamples, withBootstrap } from './lib/stats.ts';
import type { Stat } from './lib/stats.ts';
import { answersOf } from './lib/stats.ts';
import { bootstrapPool } from './lib/bootstrapPool.ts';
import { mergeQuestions, splitGroup, toggleIncluded } from './lib/groups.ts';
import { summarizeOpenQuestion } from './lib/ai.ts';
import { loadKey } from './lib/storage.ts';
import type { AIResult, Dataset, Question, QuestionType } from './types.ts';

type View = 'home' | 'workspace' | 'compare' | 'report';

function readHash(): View {
  if (location.hash === '#/workspace') return 'workspace';
  if (location.hash === '#/report') return 'report';
  if (location.hash === '#/compare') return 'compare';
  return 'home';
}

const DEMO_NAME = '大学生AI工具使用调查（示例）.csv';

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [title, setTitle] = useState('');
  const [aiResults, setAiResults] = useState<Record<string, AIResult>>({});
  const [aiOpen, setAiOpen] = useState(false);
  const [hasKey, setHasKey] = useState(() => loadKey() !== '');
  const [view, setView] = useState<View>(readHash);
  const [pick, setPick] = useState<ComparisonPick | null>(null);
  const [pickNotice, setPickNotice] = useState('');

  const latest = useRef(dataset);
  latest.current = dataset;

  // 题目对象在改题型/忽略时才会换新，按 rows + 题目对象缓存统计，避免每次编辑重跑全量 Bootstrap。
  const statCache = useRef(new WeakMap<Record<string, string>[], WeakMap<Question, Stat>>());

  // 数值题的区间在后台线程补上，每补上一道题就重取一次 stats。
  const [bootTick, setBootTick] = useState(0);
  const booting = useRef(new WeakSet<Question>());

  useEffect(() => {
    const sync = () => setView(readHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const go = (next: View) => {
    const hash = next === 'home' ? '' : `#/${next}`;
    if (location.hash === hash || (next === 'home' && location.hash === '#')) setView(next);
    else location.hash = hash;
  };

  // 分组题被改成其他题型或忽略后，交叉分析的选择随之作废。
  useEffect(() => {
    if (dataset && pick && !pickStillValid(dataset, pick)) {
      setPick(null);
      setPickNotice('分组题须为未被忽略的单选题，交叉分析已清空。');
    }
  }, [dataset, pick]);

  const adopt = (ds: Dataset, name: string) => {
    setDataset(ds);
    setPick(null);
    setPickNotice('');
    setAiResults({});
    setTitle(name.replace(/\.[^.]+$/, ''));
    go('workspace');
  };

  const load = async (file: File) => {
    adopt(await parseFile(file), file.name);
  };

  const loadDemo = async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}demo-survey.csv`);
    if (!res.ok) throw new Error('示例数据加载失败，请确认 public/demo-survey.csv 存在。');
    const text = await res.text();
    // 去掉 BOM 后按 UTF-8 重建，保证与用户上传同一解析路径。
    const file = new File([text.replace(/^\ufeff/, '')], DEMO_NAME, { type: 'text/csv' });
    adopt(await parseFile(file), file.name);
  };

  const stats = useMemo(() => {
    const map: Record<string, Stat> = {};
    if (!dataset) return map;
    let cache = statCache.current.get(dataset.rows);
    if (!cache) {
      cache = new WeakMap();
      statCache.current.set(dataset.rows, cache);
    }
    for (const q of dataset.questions) {
      if (!q.included) continue;
      let stat = cache.get(q);
      if (!stat) {
        stat = computeStat(q, dataset.rows, { deferBootstrap: true });
        cache.set(q, stat);
      }
      map[q.id] = stat;
    }
    return map;
  }, [dataset, bootTick]);
  // 首屏不等重抽样：点估计和直方图先渲染，再把缺区间的数值题交给后台线程。
  useEffect(() => {
    if (!dataset) return;
    const { rows } = dataset;
    const cache = statCache.current.get(rows);
    if (!cache) return;
    for (const q of dataset.questions) {
      const stat = cache.get(q);
      if (!stat || stat.kind !== 'numeric' || !stat.ciPending || booting.current.has(q)) continue;
      booting.current.add(q);
      bootstrapPool.run(numericSamples(q, rows), (boot) => {
        booting.current.delete(q);
        // 期间换了文件或改过这道题时，写进去的是旧对象的结果，不会再被读到。
        statCache.current.get(rows)?.set(q, withBootstrap(stat, boot));
        setBootTick((t) => t + 1);
      });
    }
  }, [dataset]);
  const pendingIntervals = useMemo(() => Object.values(stats).filter((s) => s.kind === 'numeric' && s.ciPending).length, [stats]);
  const comparison = useMemo(() => (dataset ? comparisonFor(dataset, pick) : null), [dataset, pick]);
  const findings = useMemo(() => (dataset ? buildFindings(dataset.rows, dataset.questions, stats) : []), [dataset, stats]);

  const changeType = (id: string, type: QuestionType) =>
    setDataset((d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((q) =>
              q.id === id ? { ...q, type, included: type === 'meta' ? false : q.type === 'meta' ? true : q.included } : q,
            ),
          }
        : d,
    );

  const toggle = (id: string) => setDataset((d) => (d ? toggleIncluded(d, id) : d));

  const mergeIntoGroup = (ids: string[], groupTitle: string) => setDataset((d) => (d ? mergeQuestions(d, ids, groupTitle) : d));
  const split = (groupId: string) => setDataset((d) => (d ? splitGroup(d, groupId) : d));

  const runAI = async (q: Question) => {
    if (!dataset) return;
    const rows = dataset.rows;
    const valid = answersOf(q, rows).valid;
    const result = await summarizeOpenQuestion(currentConfig(), q.title, valid);
    // 期间换了文件就不要把结果写到新数据上；只调整题型不影响同一列的归纳结果。
    if (latest.current?.rows === rows) setAiResults((r) => ({ ...r, [q.id]: result }));
  };

  const showReport = view === 'report' && !!dataset;
  const showWorkspace = view === 'workspace' && !!dataset;
  const showCompare = view === 'compare' && !!dataset;

  return (
    <>
      {showWorkspace || showCompare || showReport ? (
        <header className="topbar">
          {showReport ? (
            <button className="btn" onClick={() => go('workspace')}>
              ← 返回工作台
            </button>
          ) : (
            <>
              <Brand onClick={() => go('home')} />
              <nav className="topbar-nav" aria-label="页面">
                <button className={showCompare ? '' : 'active'} onClick={() => go('workspace')}>
                  工作台
                </button>
                <button className={showCompare ? 'active' : ''} onClick={() => go('compare')}>
                  交叉分析
                </button>
              </nav>
            </>
          )}
          <div className="topbar-actions">
            <button className="btn ghost" onClick={() => setAiOpen(true)}>
              模型设置
            </button>
            {showReport ? (
              <button className="btn primary" onClick={() => window.print()} disabled={pendingIntervals > 0}>
                打印 / 另存为 PDF
              </button>
            ) : (
              <button className="btn primary" onClick={() => go('report')}>
                生成报告
              </button>
            )}
          </div>
        </header>
      ) : null}

      <ErrorBoundary key={`${view}:${dataset?.importedAt ?? ''}`}>
        {showWorkspace && dataset ? (
          <Workspace
            dataset={dataset}
            stats={stats}
            findings={findings}
            title={title}
            onTitle={setTitle}
            onChangeType={changeType}
            onToggle={toggle}
            onMergeQuestions={mergeIntoGroup}
            onSplitGroup={split}
            onLoad={load}
            onDemo={loadDemo}
            aiResults={aiResults}
            hasKey={hasKey}
            onOpenSettings={() => setAiOpen(true)}
            onRun={runAI}
          />
        ) : showCompare && dataset ? (
          <ComparePage
            dataset={dataset}
            pick={pick}
            notice={pickNotice}
            onSelect={(next) => {
              setPickNotice('');
              setPick(next);
            }}
          />
        ) : showReport && dataset ? (
          <div className="report-wrap">
            {pendingIntervals > 0 && <p className="alert report-pending">还有 {pendingIntervals} 道数值题的 95% 区间在后台计算，算完后才能打印。</p>}
            <Report dataset={dataset} stats={stats} findings={findings} title={title} aiResults={aiResults} comparison={comparison} />
          </div>
        ) : (
          <Home onLoad={load} onDemo={loadDemo} resumeTitle={dataset ? title : undefined} onResume={() => go('workspace')} />
        )}
      </ErrorBoundary>

      {aiOpen && (
        <Modal title="模型设置" onClose={() => setAiOpen(false)}>
          <AISettings
            initial={currentConfig()}
            onClose={() => setAiOpen(false)}
            onSave={() => setHasKey(loadKey() !== '')}
          />
        </Modal>
      )}
    </>
  );
}
