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
import { buildFindings, computeStat, numericSamples, validRowCount, withBootstrap } from './lib/stats.ts';
import type { Stat } from './lib/stats.ts';
import { answersOf } from './lib/stats.ts';
import { reliability } from './lib/reliability.ts';
import type { Reliability } from './lib/reliability.ts';
import { analysisRows, cleaningSummary } from './lib/cleaning.ts';
import type { CleaningSummary } from './lib/cleaning.ts';
import { scoreStates, setScore, withScores } from './lib/scores.ts';
import type { ScoreState } from './lib/scores.ts';
import { bootstrapPool } from './lib/bootstrapPool.ts';
import { includedItems, mergeQuestions, splitGroup, toggleIncluded, toggleReversed } from './lib/groups.ts';
import { summarizeOpenQuestion } from './lib/ai.ts';
import { loadKey } from './lib/storage.ts';
import { buildReportHtml } from './lib/exportHtml.ts';
import { downloadText, reportFileName } from './lib/reportFile.ts';
import { exportReportPdf } from './lib/exportPdf.ts';
import type { AIResult, Cleaning, Dataset, Question, QuestionType, ScoreMissing } from './types.ts';
import { PRO_MODE_OFF } from './types.ts';
import type { ProModeOptions, ScoreForm } from './types.ts';
import { setScoreForm } from './lib/scores.ts';
import { reliabilityExtras } from './lib/reliabilityExtras.ts';
import type { ReliabilityExtras } from './lib/reliabilityExtras.ts';
import { ProModePanel } from './components/ProModePanel.tsx';
import { DiagnosticsPage } from './components/DiagnosticsPage.tsx';
import { buildDiagnostics } from './lib/diagnostics.ts';

type View = 'home' | 'workspace' | 'compare' | 'correlation' | 'diagnostics' | 'report';

function readHash(): View {
  if (location.hash === '#/workspace') return 'workspace';
  if (location.hash === '#/report') return 'report';
  if (location.hash === '#/compare') return 'compare';
  if (location.hash === '#/correlation') return 'correlation';
  if (location.hash === '#/diagnostics') return 'diagnostics';
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
  // 专业模式：报告页的开关，默认全关；只在内存里，刷新即清除。
  const [pro, setPro] = useState<ProModeOptions>(PRO_MODE_OFF);
  const [proOpen, setProOpen] = useState(false);
  // 一键 PDF 的进度；非空时按钮换成进度与取消。
  const [exportState, setExportState] = useState<{ done: number; total: number } | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const cancelExport = useRef(false);

  const latest = useRef(dataset);
  latest.current = dataset;

  // 题目对象在改题型/忽略时才会换新，按 rows + 题目对象缓存统计，避免每次编辑重跑全量 Bootstrap。
  // 专业模式打开分布描述时，统计对象多一个 shape 字段，所以两种口径各用一份缓存。
  const statCaches = useRef({
    plain: new WeakMap<Record<string, string>[], WeakMap<Question, Stat>>(),
    shape: new WeakMap<Record<string, string>[], WeakMap<Question, Stat>>(),
  });
  const statCache = () => (pro.distribution ? statCaches.current.shape : statCaches.current.plain);

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

  // 诊断页的「查看」：回到工作台对应卡片并高亮短暂一下。
  const jumpToCard = (index: number) => {
    go('workspace');
    requestAnimationFrame(() => {
      const el = document.getElementById(`card-${index}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('card-flash');
      window.setTimeout(() => el.classList.remove('card-flash'), 1600);
    });
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

  // 报告的三个出口都基于当前屏幕上的这份 DOM，导出不会改动分析状态。
  const reportElement = () => document.querySelector<HTMLElement>('.report-wrap .page');
  const exportHtml = () => {
    const el = reportElement();
    if (!el) return;
    downloadText(reportFileName(title, 'html'), buildReportHtml(el.outerHTML, title || '问卷分析报告'));
  };
  const exportPdf = async () => {
    const el = reportElement();
    if (!el || exportState) return;
    cancelExport.current = false;
    setExportState({ done: 0, total: 0 });
    try {
      await exportReportPdf({
        element: el,
        title: title || '问卷分析报告',
        onProgress: (done, total) => setExportState({ done, total }),
        shouldCancel: () => cancelExport.current,
      });
    } finally {
      setExportState(null);
    }
  };
  const startPrint = () => {
    // 先关掉提示层再打印，避免提示层被一起印进 PDF。
    setPrintOpen(false);
    requestAnimationFrame(() => window.print());
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
      const caches = statCache();
      let cache = caches.get(rows);
      if (!cache) {
        cache = new WeakMap();
        caches.set(rows, cache);
      }
      let stat = cache.get(q);
      if (!stat) {
        stat = computeStat(q, rows, { deferBootstrap: true, shape: pro.distribution });
        cache.set(q, stat);
      }
      map[q.id] = stat;
    }
    return map;
  }, [analysis, scoredRows, baseRows, bootTick, pro.distribution]);
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
        statCache().get(rows)?.set(q, withBootstrap(stat, boot));
        setBootTick((t) => t + 1);
      });
    }
  }, [analysis, stats, scoredRows, baseRows, pro.distribution]);
  // 各组中位数的区间在后台线程算：均值和差值先出，算完一组补一组。
  const baseComparison = useMemo(() => (analysis ? comparisonFor(analysis, pick, scoredRows, pro) : null), [analysis, pick, scoredRows, pro.on, pro.correction, pro.rankTest]);
  const corr = useMemo(() => (analysis ? correlationFor(analysis, corrVars, scoredRows, { adjust: pro.correction, rank: pro.spearman }) : null), [analysis, corrVars, scoredRows, pro.correction, pro.spearman]);
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
  // 专业模式的信度扩展：α 区间、KMO、Bartlett、单因子 ω。
  const extras = useMemo(() => {
    const map: Record<string, ReliabilityExtras | null> = {};
    if (!dataset) return map;
    for (const g of dataset.groups) map[g.id] = reliabilityExtras(dataset.questions.filter((q) => q.groupId === g.id && q.included), baseRows, pro);
    return map;
  }, [dataset, baseRows, pro.alphaCI, pro.factorCheck, pro.on]);
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
  const scoreForm = (groupId: string, form: ScoreForm) => setDataset((d) => (d ? setScoreForm(d, groupId, form) : d));

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
  const showDiagnostics = view === 'diagnostics' && !!dataset;
  // 卡片顺序与工作台一致，诊断里的「查看」用它跳回对应卡片。
  const cardItems = useMemo(() => (analysis ? includedItems(analysis) : []), [analysis]);
  const diagnostics = useMemo(
    () => (analysis ? buildDiagnostics({ dataset: analysis, items: cardItems, stats, reliabilities, extras }) : null),
    [analysis, cardItems, stats, reliabilities, extras],
  );
  // 顶栏按钮上的启用项数，以及报告顶部的一行摘要（让“打开后报告变了什么”一眼可见）。
  const proCount = [
    pro.correction !== null,
    pro.effectSize,
    pro.alphaCI,
    pro.distribution || pro.missingTable,
    pro.apaTables,
    pro.spearman,
    pro.rankTest,
    pro.scoreForms,
    pro.factorCheck,
  ].filter(Boolean).length;
  const proSummary = pro.on
    ? [
        pro.correction ? `${pro.correction === 'holm' ? 'Holm' : 'BH'} 校正` : '',
        pro.effectSize ? "Cramér's V" : '',
        pro.alphaCI ? 'α 区间' : '',
        pro.distribution || pro.missingTable ? '偏度/峰度 · 缺失率' : '',
        pro.apaTables ? '三线表' : '',
        pro.spearman ? 'Spearman' : '',
        pro.rankTest ? '秩检验' : '',
        pro.scoreForms ? '得分形式' : '',
        pro.factorCheck ? 'KMO / ω' : '',
      ].filter(Boolean)
    : [];

  return (
    <>
      {showWorkspace || showCompare || showCorrelation || showDiagnostics || showReport ? (
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
                {pro.on && (
                  <button className={showDiagnostics ? 'active' : ''} onClick={() => go('diagnostics')}>
                    数据诊断
                  </button>
                )}
              </nav>
            </>
          )}
          <div className="topbar-actions">
            <button className={`btn ghost pro-toggle${pro.on ? ' on' : ''}`} onClick={() => setProOpen(true)} title="专业模式：多重比较校正、效应量、分布描述与非参数检验">
              专业模式{pro.on ? ` · ${proCount} 项` : ''}
            </button>
            <button className="btn ghost" onClick={() => setAiOpen(true)}>
              模型设置
            </button>
            {showReport ? (
              <button className="btn primary" onClick={() => setPrintOpen(true)} disabled={pendingIntervals > 0 || !!exportState}>
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
            extras={extras}
            onToggleReversed={reverse}
            rows={baseRows}
            scoreStates={scoreList}
            onScore={score}
            onScoreForm={scoreForm}
            scoreFormsEnabled={pro.on && pro.scoreForms}
            proDistribution={pro.on && pro.distribution}
            proMissingRate={pro.on && pro.missingTable}
            cleaning={cleaning}
            onOpenCleaning={() => setCleaningOpen(true)}
          />
        ) : showCompare && analysis ? (
          <ComparePage
            pro={pro}
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
          <CorrelationPage dataset={analysis} selected={corrVars} onToggle={toggleCorr} onClear={() => setCorrVars([])} corr={corr} pro={pro} />
        ) : showDiagnostics && analysis && diagnostics ? (
          <DiagnosticsPage
            dataset={analysis}
            items={cardItems}
            rows={scoredRows}
            diagnostics={diagnostics}
            corr={corr}
            pro={pro}
            valid={validRowCount(analysis, baseRows)}
            onJump={jumpToCard}
            onOpenPro={() => setProOpen(true)}
            onGoCorrelation={() => go('correlation')}
          />
        ) : showReport && analysis ? (
          <div className="report-wrap">
            {pro.on && (
              <p className="pro-summary">
                <span>专业口径：{proSummary.join(' · ')}</span>
                <button type="button" className="link" onClick={() => document.getElementById('r-quality')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  查看数据质量
                </button>
              </p>
            )}
            <div className="report-bar">
              <p className="report-tip">导出或打印的文件包含问卷的聚合结果与开放题引文，请自行确认分享范围。</p>
              <div className="report-exports">
                {exportState ? (
                  <div className="export-progress" role="status">
                    <span>
                      {exportState.done === 0 ? '正在准备 PDF…' : `正在生成 PDF ${exportState.done}/${exportState.total}`}
                    </span>
                    <button className="link" onClick={() => (cancelExport.current = true)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <>
                    <button className="btn ghost" onClick={exportHtml} disabled={pendingIntervals > 0} title="自包含 HTML：内联样式与图表，断网可看">
                      导出 HTML
                    </button>
                    <button className="btn ghost" onClick={exportPdf} disabled={pendingIntervals > 0} title="图片版 PDF，文字不可选中；需要可选中文字请用打印">
                      下载 PDF
                    </button>
                  </>
                )}
              </div>
            </div>
            {pendingIntervals > 0 && <p className="alert report-pending">还有 {pendingIntervals} 处 95% 区间在后台计算，算完后才能打印或导出。</p>}
            <Report dataset={analysis} stats={stats} findings={findings} title={title} aiResults={aiResults} comparison={comparison} correlation={corr} reliabilities={reliabilities} rows={baseRows} cleaning={cleaning} pro={pro} extras={extras} diagnostics={diagnostics} />
          </div>
        ) : (
          <Home onLoad={load} onDemo={loadDemo} resumeTitle={dataset ? title : undefined} onResume={() => go('workspace')} />
        )}
      </ErrorBoundary>

      {proOpen && (
        <Modal title="专业模式" wide onClose={() => setProOpen(false)}>
          <ProModePanel pro={pro} onChange={setPro} bare />
        </Modal>
      )}

      {printOpen && (
        <Modal title="打印 / 另存为 PDF" onClose={() => setPrintOpen(false)}>
          <div className="ai-form">
            <p className="hint">
              在打印对话框里把目标选成「另存为 PDF」，勾选「背景图形」以保留底色，页边距用默认值即可。这条路径输出的是矢量 PDF，文字可以选中、文件更小；一键「下载 PDF」是图片版。
            </p>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setPrintOpen(false)}>
                取消
              </button>
              <button type="button" className="btn primary" onClick={startPrint}>
                继续打印
              </button>
            </div>
          </div>
        </Modal>
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

      {cleaningOpen && dataset && (
        <Modal title="数据清洗" wide onClose={() => setCleaningOpen(false)}>
          <CleaningPanel dataset={dataset} onClose={() => setCleaningOpen(false)} onApply={applyCleaning} />
        </Modal>
      )}
    </>
  );
}
