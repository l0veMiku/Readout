import { useEffect, useMemo, useRef, useState } from 'react';
import { Brand, Home } from './components/Home.tsx';
import { Workspace } from './components/Workspace.tsx';
import { Report } from './components/Report.tsx';
import { ComparePage, comparisonFor, isGroupQuestion, pickStillValid } from './components/Compare.tsx';
import type { ComparisonPick } from './components/Compare.tsx';
import { CorrelationPage } from './components/Correlation.tsx';
import { correlationFor, isCorrQuestion } from './lib/correlation.ts';
import { withMedianIntervals } from './lib/compare.ts';
import type { Comparison } from './lib/compare.ts';
import type { Interval } from './lib/intervals.ts';
import { Modal } from './components/Modal.tsx';
import { CleaningPanel } from './components/CleaningPanel.tsx';
import { AISettings, currentConfig } from './components/AISettings.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { parseFile } from './lib/parse.ts';
import { buildFindings, computeStat, numericSamples, withBootstrap } from './lib/stats.ts';
import type { Stat } from './lib/stats.ts';
import { answersOf } from './lib/stats.ts';
import { reliability } from './lib/reliability.ts';
import type { Reliability } from './lib/reliability.ts';
import { analysisRows, cleaningSummary } from './lib/cleaning.ts';
import type { CleaningSummary } from './lib/cleaning.ts';
import { scoreStates, setScore, withScores } from './lib/scores.ts';
import type { ScoreState } from './lib/scores.ts';
import { bootstrapPool } from './lib/bootstrapPool.ts';
import { mergeQuestions, splitGroup, toggleIncluded, toggleReversed } from './lib/groups.ts';
import { summarizeOpenQuestion } from './lib/ai.ts';
import { loadKey } from './lib/storage.ts';
import type { AIResult, Cleaning, Dataset, Question, QuestionType, ScoreMissing } from './types.ts';

type View = 'home' | 'workspace' | 'compare' | 'correlation' | 'report';

function readHash(): View {
  if (location.hash === '#/workspace') return 'workspace';
  if (location.hash === '#/report') return 'report';
  if (location.hash === '#/compare') return 'compare';
  if (location.hash === '#/correlation') return 'correlation';
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
  // 相关分析选的变量；和交叉分析一样只存在内存里，刷新即清除。
  const [corrVars, setCorrVars] = useState<string[]>([]);

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

  const adopt = (ds: Dataset, name: string) => {
    setDataset(ds);
    setPick(null);
    setPickNotice('');
    setCorrVars([]);
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

  // 计入分析的问卷。没有清洗设置时就是 dataset.rows 本身；原始行、清洗设置和纳入的题都没变时沿用同一个数组，统计缓存才用得上。
  const includedKey = dataset ? dataset.questions.filter((q) => q.included).map((q) => q.id).join(' ') : '';
  const baseRows = useMemo(() => (dataset ? analysisRows(dataset) : []), [dataset?.rows, dataset?.cleaning, includedKey]);
  // 维度得分：题目和每一行的得分都在这里算出来，不写回原始数据。定义没变时沿用同一份状态，带得分列的行才不会换新。
  const scoreRef = useRef<{ rows: Record<string, string>[]; states: ScoreState[] }>({ rows: [], states: [] });
  const scoreList = useMemo(() => {
    const next = dataset ? scoreStates(dataset, baseRows) : [];
    const prev = scoreRef.current;
    const same =
      prev.rows === baseRows &&
      prev.states.length === next.length &&
      prev.states.every((p, i) => p.group === next[i].group && p.missing === next[i].missing && p.question === next[i].question);
    const states = same ? prev.states : next;
    scoreRef.current = { rows: baseRows, states };
    return states;
  }, [dataset, baseRows]);
  const scoredRows = useMemo(() => withScores(baseRows, scoreList), [baseRows, scoreList]);
  // 分析用的数据集：维度得分作为一道数值题，紧跟在它的题组后面。
  const analysis = useMemo(() => {
    const derived = new Map(scoreList.flatMap((s) => (s.question && s.missing ? [[s.group.id, s.question] as [string, Question]] : [])));
    if (!dataset || derived.size === 0) return dataset;
    // 题组卡片画在第一个成员的位置，得分就插在它后面；合并出来的题组成员不一定相邻。
    const anchor = new Map<string, number>();
    dataset.questions.forEach((q, i) => {
      if (q.groupId && derived.has(q.groupId) && !anchor.has(q.groupId)) anchor.set(q.groupId, i);
    });
    const questions: Question[] = [];
    dataset.questions.forEach((q, i) => {
      questions.push(q);
      if (q.groupId && anchor.get(q.groupId) === i) questions.push(derived.get(q.groupId)!);
    });
    return { ...dataset, questions };
  }, [dataset, scoreList]);
  // 分组题被改成其他题型或忽略后，交叉分析的选择随之作废；对比题被忽略或得分被移除时也一样。
  useEffect(() => {
    if (!analysis || !pick || pickStillValid(analysis, pick)) return;
    setPick(null);
    setPickNotice(isGroupQuestion(analysis.questions.find((q) => q.id === pick.group)) ? '对比题不可用了（被忽略、改了题型或移除了得分），交叉分析已清空。' : '分组题须为未被忽略的单选题，交叉分析已清空。');
  }, [analysis, pick]);
  const stats = useMemo(() => {
    const map: Record<string, Stat> = {};
    if (!analysis) return map;
    for (const q of analysis.questions) {
      if (!q.included) continue;
      // 普通题目读原始行，得分题目读带得分列的行；两组行的身份各自稳定，缓存互不干扰。
      const rows = q.derived ? scoredRows : baseRows;
      let cache = statCache.current.get(rows);
      if (!cache) {
        cache = new WeakMap();
        statCache.current.set(rows, cache);
      }
      let stat = cache.get(q);
      if (!stat) {
        stat = computeStat(q, rows, { deferBootstrap: true });
        cache.set(q, stat);
      }
      map[q.id] = stat;
    }
    return map;
  }, [analysis, scoredRows, baseRows, bootTick]);
  // 首屏不等重抽样：点估计和直方图先渲染，再把缺区间的数值题交给后台线程。
  useEffect(() => {
    if (!analysis) return;
    for (const q of analysis.questions) {
      const stat = stats[q.id];
      if (!stat || stat.kind !== 'numeric' || !stat.ciPending || booting.current.has(q)) continue;
      const rows = q.derived ? scoredRows : baseRows;
      booting.current.add(q);
      bootstrapPool.run(numericSamples(q, rows), (boot) => {
        booting.current.delete(q);
        // 期间换了文件或改过这道题时，写进去的是旧对象的结果，不会再被读到。
        statCache.current.get(rows)?.set(q, withBootstrap(stat, boot));
        setBootTick((t) => t + 1);
      });
    }
  }, [analysis, stats, scoredRows, baseRows]);
  // 各组中位数的区间在后台线程算：均值和差值先出，算完一组补一组。
  const baseComparison = useMemo(() => (analysis ? comparisonFor(analysis, pick, scoredRows) : null), [analysis, pick, scoredRows]);
  const corr = useMemo(() => (analysis ? correlationFor(analysis, corrVars, scoredRows) : null), [analysis, corrVars, scoredRows]);
  // 选的题被忽略、改了题型或被移除后，相关分析的变量跟着去掉。
  useEffect(() => {
    if (!analysis) return;
    setCorrVars((prev) => {
      const keep = prev.filter((id) => isCorrQuestion(analysis.questions.find((q) => q.id === id)));
      return keep.length === prev.length ? prev : keep;
    });
  }, [analysis]);
  const toggleCorr = (id: string) => setCorrVars((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  const [medianCis, setMedianCis] = useState<{ for: Comparison; done: (Interval | null | undefined)[] } | null>(null);
  const comparing = useRef(new WeakSet<Comparison>());
  const currentComparison = useRef(baseComparison);
  currentComparison.current = baseComparison;
  const comparison = useMemo(
    () => (baseComparison?.medianPending && medianCis?.for === baseComparison ? withMedianIntervals(baseComparison, medianCis.done) : baseComparison),
    [baseComparison, medianCis],
  );
  useEffect(() => {
    const base = baseComparison;
    if (!base?.medianPending || !base.medianSamples || comparing.current.has(base)) return;
    comparing.current.add(base);
    const samples = base.medianSamples;
    samples.forEach((xs, gi) => {
      bootstrapPool.run(xs, (boot) => {
        // 期间换了分组题或对比题：旧结果不再使用。
        if (currentComparison.current !== base) return;
        setMedianCis((s) => {
          const done = s?.for === base ? [...s.done] : samples.map(() => undefined);
          done[gi] = boot.median;
          return { for: base, done };
        });
      });
    });
  }, [baseComparison]);
  // 报告要等所有区间到齐才能打印：数值题每道算一处，交叉分析每组各算一处。
  const pendingIntervals = useMemo(() => {
    const questions = Object.values(stats).filter((s) => s.kind === 'numeric' && s.ciPending).length;
    const groups = baseComparison?.medianSamples?.length ?? 0;
    const settled = medianCis?.for === baseComparison ? medianCis.done.filter((ci) => ci !== undefined).length : 0;
    return questions + groups - settled;
  }, [stats, baseComparison, medianCis]);
  const findings = useMemo(() => (analysis ? buildFindings(baseRows, analysis.questions, stats) : []), [analysis, baseRows, stats]);
  // 题组的信度：有两道以上量表子题时才有结果。反向标记一变，题目对象换新，这里跟着重算。
  const reliabilities = useMemo(() => {
    const map: Record<string, Reliability | null> = {};
    if (!dataset) return map;
    for (const g of dataset.groups) map[g.id] = reliability(dataset.questions.filter((q) => q.groupId === g.id && q.included), baseRows);
    return map;
  }, [dataset, baseRows]);
  const cleaning = useMemo<CleaningSummary | null>(() => (dataset ? cleaningSummary(dataset) : null), [dataset]);
  const applyCleaning = (next: Cleaning | undefined) => setDataset((d) => (d ? { ...d, cleaning: next } : d));

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
  const reverse = (id: string) => setDataset((d) => (d ? toggleReversed(d, id) : d));
  const score = (groupId: string, missing: ScoreMissing | null) => setDataset((d) => (d ? setScore(d, groupId, missing) : d));

  const runAI = async (q: Question) => {
    if (!dataset) return;
    const snapshot = dataset;
    const valid = answersOf(q, baseRows).valid;
    const result = await summarizeOpenQuestion(currentConfig(), q.title, valid);
    // 期间换了文件或改了清洗设置，就不要把结果写到新数据上；只调整题型不影响同一列的归纳结果。
    if (latest.current?.rows === snapshot.rows && latest.current?.cleaning === snapshot.cleaning) setAiResults((r) => ({ ...r, [q.id]: result }));
  };

  const [cleaningOpen, setCleaningOpen] = useState(false);
  const showReport = view === 'report' && !!dataset;
  const showWorkspace = view === 'workspace' && !!dataset;
  const showCompare = view === 'compare' && !!dataset;
  const showCorrelation = view === 'correlation' && !!dataset;

  return (
    <>
      {showWorkspace || showCompare || showCorrelation || showReport ? (
        <header className="topbar">
          {showReport ? (
            <button className="btn" onClick={() => go('workspace')}>
              ← 返回工作台
            </button>
          ) : (
            <>
              <Brand onClick={() => go('home')} />
              <nav className="topbar-nav" aria-label="页面">
                <button className={showWorkspace ? 'active' : ''} onClick={() => go('workspace')}>
                  工作台
                </button>
                <button className={showCompare ? 'active' : ''} onClick={() => go('compare')}>
                  交叉分析
                </button>
                <button className={showCorrelation ? 'active' : ''} onClick={() => go('correlation')}>
                  相关分析
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
        {showWorkspace && analysis ? (
          <Workspace
            dataset={analysis}
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
            reliabilities={reliabilities}
            onToggleReversed={reverse}
            rows={baseRows}
            scoreStates={scoreList}
            onScore={score}
            cleaning={cleaning}
            onOpenCleaning={() => setCleaningOpen(true)}
          />
        ) : showCompare && analysis ? (
          <ComparePage
            dataset={analysis}
            pick={pick}
            notice={pickNotice}
            onSelect={(next) => {
              setPickNotice('');
              setPick(next);
            }}
            comparison={comparison}
          />
        ) : showCorrelation && analysis ? (
          <CorrelationPage dataset={analysis} selected={corrVars} onToggle={toggleCorr} corr={corr} />
        ) : showReport && analysis ? (
          <div className="report-wrap">
            {pendingIntervals > 0 && <p className="alert report-pending">还有 {pendingIntervals} 处 95% 区间在后台计算，算完后才能打印。</p>}
            <Report dataset={analysis} stats={stats} findings={findings} title={title} aiResults={aiResults} comparison={comparison} correlation={corr} reliabilities={reliabilities} rows={baseRows} cleaning={cleaning} />
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

      {cleaningOpen && dataset && (
        <Modal title="数据清洗" wide onClose={() => setCleaningOpen(false)}>
          <CleaningPanel dataset={dataset} onClose={() => setCleaningOpen(false)} onApply={applyCleaning} />
        </Modal>
      )}
    </>
  );
}
