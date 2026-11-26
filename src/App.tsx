import { useEffect, useMemo, useRef, useState } from 'react';
import { Brand, Home } from './components/Home.tsx';
import { Workspace } from './components/Workspace.tsx';
import { Report } from './components/Report.tsx';
import { ComparePage, comparisonFor, pickStillValid } from './components/Compare.tsx';
import type { ComparisonPick } from './components/Compare.tsx';
import { Modal } from './components/Modal.tsx';
import { AISettings, currentConfig } from './components/AISettings.tsx';
import { parseFile } from './lib/parse.ts';
import { buildFindings, computeStat } from './lib/stats.ts';
import { answersOf } from './lib/stats.ts';
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
    const map: Record<string, ReturnType<typeof computeStat>> = {};
    for (const q of dataset?.questions ?? []) map[q.id] = computeStat(q, dataset?.rows ?? []);
    return map;
  }, [dataset]);
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

  const toggle = (id: string) =>
    setDataset((d) => (d ? { ...d, questions: d.questions.map((q) => (q.id === id ? { ...q, included: !q.included } : q)) } : d));

  const runAI = async (q: Question) => {
    if (!dataset) return;
    const snapshot = dataset;
    const valid = answersOf(q, dataset.rows).valid;
    const result = await summarizeOpenQuestion(currentConfig(), q.title, valid);
    // 期间换了文件就不要把结果写到新数据上。
    if (latest.current === snapshot) setAiResults((r) => ({ ...r, [q.id]: result }));
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
              <button className="btn primary" onClick={() => window.print()}>
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

      {showWorkspace && dataset ? (
        <Workspace
          dataset={dataset}
          stats={stats}
          findings={findings}
          title={title}
          onTitle={setTitle}
          onChangeType={changeType}
          onToggle={toggle}
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
          <Report dataset={dataset} stats={stats} findings={findings} title={title} aiResults={aiResults} comparison={comparison} />
        </div>
      ) : (
        <Home onLoad={load} onDemo={loadDemo} resumeTitle={dataset ? title : undefined} onResume={() => go('workspace')} />
      )}

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
