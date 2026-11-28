import type { ReliabilityExtras } from '../lib/reliabilityExtras.ts';
import { kmoBand } from '../lib/diagnostics.ts';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AIError, SENTIMENT_LABELS } from '../lib/ai.ts';
import type { OptionRow, Stat } from '../lib/stats.ts';
import { sampleNote, withCI, withPctCI } from '../lib/stats.ts';
import type { Reliability } from '../lib/reliability.ts';
import { SCORE_MISSING_LABELS } from '../lib/scores.ts';
import type { ScoreState } from '../lib/scores.ts';
import { capBars, horizontalBars, meanIntervals, verticalBars } from '../lib/charts.ts';
import { ciDigits, formatCI, formatDateTime, formatNumber, formatPct, formatPctCI } from '../lib/text.ts';
import { QUESTION_TYPES, TYPE_LABELS } from '../types.ts';
import type { AIResult, Question, QuestionGroup, QuestionType, ScoreMissing } from '../types.ts';
import { Chart } from './Chart.tsx';

const smartNumber = (x: number | null) => (x === null ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(2));
const pctCI = (o: OptionRow) => withPctCI(formatPct(o.pct), o.ci);

export function CIRange({ ci, digits = 1, pct = false, pending = false }: { ci: { lower: number; upper: number } | null; digits?: number; pct?: boolean; pending?: boolean }) {
  if (!ci) return pending ? <span className="ci">95% 区间计算中…</span> : null;
  return <span className="ci">95% 区间 {pct ? formatPctCI(ci) : formatCI(ci, digits)}</span>;
}

function ChartFor({ stat }: { stat: Stat }) {
  // 数值题的区间在后台补上时 bins 不变，图表不必重建。
  const chartKey = stat.kind === 'numeric' ? stat.bins : stat;
  const bars = useMemo(() => (stat.kind === 'single' || stat.kind === 'multi' ? capBars(stat.options) : null), [chartKey]);
  const built = useMemo(() => {
    if (bars) return bars.rows.length ? horizontalBars(bars.rows) : null;
    if (stat.kind === 'scale') return stat.levels.length ? verticalBars(stat.levels, { mean: stat.numeric ? stat.mean : null }) : null;
    // 文本量表按类别轴画分布，均值只出现在结论句和指标里。
    if (stat.kind === 'numeric') return stat.bins.length ? verticalBars(stat.bins, { rotate: true }) : null;
    return null;
  }, [bars, chartKey]);
  if (!built) return null;
  return (
    <>
      <Chart option={built.option} height={built.height} />
      {bars && bars.omitted > 0 && <p className="chart-note">图表只画前 12 项，其余 {bars.omitted} 项见下方表格。</p>}
    </>
  );
}

function chips(stat: Stat): [string, string][] {
  switch (stat.kind) {
    case 'single':
      return stat.options[0]
        ? [['最多选择', `${stat.options[0].name} ${formatPct(stat.options[0].pct)}`], ['95% 区间', formatPctCI(stat.options[0].ci)], ['选项数', String(stat.options.length)]]
        : [];
    case 'multi':
      return stat.options.length
        ? [['平均选择', `${formatNumber(stat.avgSelected)} 项`], ['选项数', String(stat.options.length)]]
        : [];
    case 'scale':
      return stat.mean === null
        ? [['档位数', String(stat.levels.length)]]
        : (() => {
            const levelValues = stat.levels.map((l) => Number(l.name)).filter((x) => Number.isFinite(x));
            const outside =
              !!stat.meanCI &&
              levelValues.length > 0 &&
              (stat.meanCI.lower < Math.min(...levelValues) || stat.meanCI.upper > Math.max(...levelValues));
            return [
              ['均值', formatNumber(stat.mean, 2)],
              ['95% 区间', `${formatCI(stat.meanCI, 2)}${outside ? '（可超出刻度）' : ''}`],
              ['中位数', formatNumber(stat.median, 2)],
              ['标准差', formatNumber(stat.sd, 2)],
              ...(stat.top2 !== null ? ([['Top-2 占比', formatPct(stat.top2)]] as [string, string][]) : []),
            ];
          })();
    case 'numeric':
      return stat.mean === null
        ? []
        : [
            ['均值', smartNumber(stat.mean)],
            [
              '95% 区间',
              stat.ciPending
                ? '计算中'
                : `${formatCI(stat.meanCI, ciDigits(stat.mean))}${
                    stat.meanCI && stat.min !== null && stat.max !== null && (stat.meanCI.lower < stat.min || stat.meanCI.upper > stat.max)
                      ? '（区间可超出刻度）'
                      : ''
                  }`,
            ],
            ['中位数', smartNumber(stat.median)],
            ['标准差', smartNumber(stat.sd)],
            ['范围', `${smartNumber(stat.min)} – ${smartNumber(stat.max)}`],
          ];
    case 'open':
      return [['平均字数', formatNumber(stat.avgChars, 0)]];
  }
}

export function sentence(stat: Stat, derived = false) {
  const head = derived
    ? `有效得分 ${stat.n} 份${stat.missing > 0 ? `（另有 ${stat.missing} 份没有得分）` : ''}`
    : `有效回答 ${stat.n} 条${stat.missing > 0 ? `（缺失 ${stat.missing}）` : ''}`;
  const top = (o: OptionRow | undefined, verb: string) => (o ? [`${verb} ${o.name} ${pctCI(o)}`] : []);
  const parts: string[] = [];
  switch (stat.kind) {
    case 'single':
      parts.push(...top(stat.options[0], '最多选择'));
      break;
    case 'multi':
      parts.push(...top(stat.options[0], '选择最多'));
      if (stat.options.length) parts.push(`平均每人选 ${formatNumber(stat.avgSelected)} 项`);
      break;
    case 'scale':
      if (stat.mean !== null) {
        parts.push(withCI(`均值 ${formatNumber(stat.mean, 2)}`, stat.meanCI, 2), `中位数 ${formatNumber(stat.median, 2)}`, `标准差 ${formatNumber(stat.sd, 2)}`);
        if (stat.top2 !== null) parts.push(withCI(`Top-2 占比 ${formatPct(stat.top2)}`, stat.top2CI, 1));
      }
      break;
    case 'numeric':
      if (stat.mean !== null) {
        parts.push(
          withCI(`均值 ${smartNumber(stat.mean)}`, stat.meanCI, ciDigits(stat.mean)),
          withCI(`中位数 ${smartNumber(stat.median)}`, stat.medianCI, ciDigits(stat.median)),
          `标准差 ${smartNumber(stat.sd)}`,
          `范围 ${smartNumber(stat.min)} – ${smartNumber(stat.max)}`,
        );
      }
      break;
  }
  return `${head}${parts.length ? `；${parts.join('，')}` : ''}。`;
}

function DistributionTable({ stat }: { stat: Stat }) {
  const rows = stat.kind === 'single' || stat.kind === 'multi' ? stat.options : stat.kind === 'scale' ? stat.levels : null;
  const [expanded, setExpanded] = useState(false);
  if (rows) {
    const LIMIT = 10;
    const visible = rows.length > LIMIT && !expanded ? rows.slice(0, LIMIT) : rows;
    return (
      <>
      <table className="dist">
        <thead>
          <tr>
            <th>选项</th>
            <th>人数</th>
            <th>占比</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.name}>
              <td>
                {r.name}
                {r.notes && r.notes.length > 0 && (
                  <ul className="opt-notes">
                    {r.notes.slice(0, 4).map((n, i) => (
                      <li key={i}>“{n}”</li>
                    ))}
                    {r.notes.length > 4 && <li>另有 {r.notes.length - 4} 条注明</li>}
                  </ul>
                )}
              </td>
              <td>{r.count}</td>
              <td>
                <span className="meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, r.pct * 100)}%` }} />
                </span>
                {formatPct(r.pct)}
                <CIRange ci={r.ci} pct />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > LIMIT && (
        <p className="chart-note">
          <button type="button" className="link" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : `展开其余 ${rows.length - LIMIT} 项`}
          </button>
        </p>
      )}
      </>
    );
  }
  if (stat.kind === 'numeric' && stat.mean !== null) {
    // 只有均值和中位数有区间，其余各行在后台计算期间不显示「计算中」。
    const items: [string, string, { lower: number; upper: number } | null, number, boolean][] = [
      ['均值', smartNumber(stat.mean), stat.meanCI, ciDigits(stat.mean), true],
      ['中位数', smartNumber(stat.median), stat.medianCI, ciDigits(stat.median), true],
      ['标准差', smartNumber(stat.sd), null, 1, false],
      ['最小值', smartNumber(stat.min), null, 1, false],
      ['最大值', smartNumber(stat.max), null, 1, false],
    ];
    return (
      <table className="dist">
        <tbody>
          {items.map(([k, v, ci, digits, interval]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>
                {v}
                <CIRange ci={ci} digits={digits} pending={interval && stat.ciPending} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return null;
}

interface GroupBodyProps {
  questions: Question[];
  stats: Record<string, Stat>;
  // 有两道以上量表子题时才有；报告里不传切换函数，只展示。
  reliability?: Reliability | null;
  onToggleReversed?: (id: string) => void;
  // 专业模式的信度扩展：α 区间、KMO、Bartlett、单因子 ω；没启用时为空。
  extras?: ReliabilityExtras | null;
}

const plain = (x: number) => String(Number.isInteger(x) ? x : x.toFixed(2));
const three = (x: number | null) => (x === null ? '—' : x.toFixed(3));

export function GroupBody({ questions, stats, reliability: rel, onToggleReversed, extras }: GroupBodyProps) {
  const rows = questions.flatMap((q) => (stats[q.id] ? [{ q, stat: stats[q.id] }] : []));
  const means: { name: string; value: number; ci: { lower: number; upper: number } | null }[] = [];
  for (const { q, stat } of rows) {
    if ((stat.kind === 'scale' || stat.kind === 'numeric') && stat.mean !== null) means.push({ name: q.subTitle ?? q.title, value: stat.mean, ci: stat.meanCI });
  }
  const chart = means.length >= 2 ? meanIntervals(means) : null;
  const itemResults = new Map(rel?.items.map((it) => [it.id, it]) ?? []);
  // 只提示最有把握的 3 道，避免整列都是「可能是反向题」。
  const suggestedReversed = new Set(
    rel
      ? rel.items
          .filter(
            (it) =>
              it.alphaIfReversed !== null &&
              it.alphaIfReversed !== undefined &&
              rel.alpha !== null &&
              rel.alpha > 0 &&
              it.alphaIfReversed - rel.alpha >= 0.02,
          )
          .sort((a, b) => (b.alphaIfReversed! - rel.alpha!) - (a.alphaIfReversed! - rel.alpha!))
          .slice(0, 3)
          .map((it) => it.id)
      : [],
  );
  const anyReversed = questions.some((q) => q.reversed);
  return (
    <>
      {chart && (
        <div className="group-chart">
          <Chart option={chart.option} height={chart.height} />
        </div>
      )}
      {rows.some(({ stat }) => sampleNote(stat.n)) && <p className="sample-note">部分子项的有效回答不足 30 条，均值和区间较宽。</p>}
      {rel && <ReliabilityLine rel={rel} anyReversed={anyReversed} extras={extras} />}
      <table className="dist group-table">
        <thead>
          <tr>
            <th>子项</th>
            <th>有效回答</th>
            <th>概况</th>
            {rel && (
              <>
                <th className="num">校正后项总相关</th>
                <th className="num">删除该项后的 α</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ q, stat }) => {
            const item = itemResults.get(q.id);
            return (
              <tr key={q.id}>
                <td>
                  {q.subTitle ?? q.title}
                  <span className="group-type">{TYPE_LABELS[q.type]}</span>
                  {q.reversed && <span className="group-type">反向计分</span>}
                  {item && onToggleReversed && (
                    <span className="reverse-tools">
                      <button className="link" onClick={() => onToggleReversed(q.id)}>
                        {q.reversed ? '取消反向' : '标为反向'}
                      </button>
                      {!q.reversed && item.citc !== null && item.citc < 0 && suggestedReversed.has(q.id) && (
                        <span className="reverse-hint">翻转后 α 会提高，可能是反向计分题</span>
                      )}
                    </span>
                  )}
                </td>
                <td>{stat.n}</td>
                <td>{groupStatText(stat)}</td>
                {rel && (
                  <>
                    <td className="num">{item ? three(item.citc) : '—'}</td>
                    <td className="num">{item ? three(item.alphaIfDeleted) : '—'}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// 题组的信度一行：α、参与份数、翻转范围；算不出来时写原因。专业模式下追加 α 区间、KMO、Bartlett 与 ω。
function ReliabilityLine({ rel, anyReversed, extras }: { rel: Reliability; anyReversed: boolean; extras?: ReliabilityExtras | null }) {
  const range = rel.range;
  const hasPro = !!extras && (!!extras.alphaCI || extras.kmo !== null || !!extras.bartlett || extras.omega !== null);
  return (
    <>
      <p className="reliability-line">
        信度：
        {rel.alpha !== null && (
          <>
            Cronbach's α = <b>{rel.alpha.toFixed(3)}</b> · {rel.items.length} 道题 ·{' '}
          </>
        )}
        {rel.note && `${rel.note} · `}
        完整作答 {rel.n} 份
        {rel.partial > 0 && `，另有 ${rel.partial} 份未答全`}
        {anyReversed && range && ` · 翻转范围 ${plain(range.min)}–${plain(range.max)}（翻转后 = ${plain(range.min + range.max)} − 原始分）`}
      </p>
      {hasPro && (
        <div className="pro-metrics">
          {extras?.alphaCI && (
            <div>
              <span>α 95% 区间</span>
              <b>{formatCI(extras.alphaCI, 3)}</b>
            </div>
          )}
          {extras?.kmo !== null && extras?.kmo !== undefined && (
            <div>
              <span>KMO</span>
              <b>{extras.kmo.toFixed(3)}</b>
              <em>{kmoBand(extras.kmo)}</em>
            </div>
          )}
          {extras?.bartlett && (
            <div>
              <span>Bartlett</span>
              <b>χ² {formatNumber(extras.bartlett.chi2, 2)}</b>
              <em>
                df {extras.bartlett.df}，{extras.bartlett.p < 0.001 ? 'p < 0.001' : `p ${extras.bartlett.p.toFixed(3)}`}
              </em>
            </div>
          )}
          {extras?.omega !== null && extras?.omega !== undefined && (
            <div>
              <span>单因子 ω</span>
              <b>{extras.omega.toFixed(3)}</b>
              <em>近似</em>
            </div>
          )}
        </div>
      )}
      {extras?.notes.map((n) => (
        <p key={n} className="sample-note">
          {n}
        </p>
      ))}
      {rel.alpha !== null && rel.alpha < 0 && <p className="sample-note">α 为负：通常是反向题没有标记，或者这些题不属于同一维度。</p>}
    </>
  );
}

function groupStatText(stat: Stat) {
  if (stat.n === 0) return '无有效回答';
  if (stat.kind === 'scale' && stat.mean !== null) {
    const base = `均值 ${formatNumber(stat.mean, 2)}（95% 区间 ${formatCI(stat.meanCI, 2)}）`;
    return stat.top2 !== null ? `${base}，Top-2 ${formatPct(stat.top2)}` : base;
  }
  if (stat.kind === 'numeric' && stat.mean !== null) {
    return `均值 ${smartNumber(stat.mean)}（95% 区间 ${stat.ciPending ? '计算中' : formatCI(stat.meanCI, ciDigits(stat.mean))}）`;
  }
  if (stat.kind === 'single' && stat.options[0]) return `最多 ${stat.options[0].name} ${pctCI(stat.options[0])}`;
  if (stat.kind === 'multi' && stat.options[0]) return `选最多 ${stat.options[0].name} ${pctCI(stat.options[0])}`;
  if (stat.kind === 'open') return `平均 ${formatNumber(stat.avgChars, 0)} 字`;
  return '—';
}

interface GroupCardProps {
  index: number;
  group: QuestionGroup;
  questions: Question[];
  stats: Record<string, Stat>;
  reliability?: Reliability | null;
  onToggleReversed?: (id: string) => void;
  score?: ScoreState;
  onScore?: (groupId: string, missing: ScoreMissing | null) => void;
  extras?: ReliabilityExtras | null;
  onChangeType: (type: QuestionType) => void;
  onIgnore: () => void;
  onSplit: () => void;
}

export function GroupCard({ index, group, questions, stats, reliability, onToggleReversed, score, onScore, extras, onChangeType, onIgnore, onSplit }: GroupCardProps) {
  const types = new Set(questions.map((q) => q.type));
  const shared = types.size === 1 ? questions[0].type : '';
  return (
    <article className="card" id={`card-${index}`}>
      <header className="card-head">
        <h3>
          <span className="qno">{index + 1}</span>
          {group.title}
          <span className="tag">题组</span>
        </h3>
        <div className="card-tools">
          <label className="sr-only" htmlFor={`type-${index}`}>
            {group.title} 的题型
          </label>
          <select id={`type-${index}`} value={shared} onChange={(e) => e.target.value && onChangeType(e.target.value as QuestionType)}>
            {shared === '' && (
              <option value="" disabled>
                混合
              </option>
            )}
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <button className="btn small ghost" onClick={onSplit}>
            拆分
          </button>
          <button className="btn small ghost" onClick={onIgnore}>
            忽略
          </button>
        </div>
      </header>
      <p className="card-meta">题组 · {questions.length} 个子项，分别统计</p>
      <GroupBody questions={questions} stats={stats} reliability={reliability} onToggleReversed={onToggleReversed} extras={extras} />
      {score && onScore && <ScoreControls score={score} onScore={onScore} />}
    </article>
  );
}

// 题组卡片底部的维度得分一行：生成、选算分条件、移除；不能生成时写明原因。
function ScoreControls({ score, onScore }: { score: ScoreState; onScore: (groupId: string, missing: ScoreMissing | null) => void }) {
  const remove = (
    <button className="btn small ghost" onClick={() => onScore(score.group.id, null)}>
      移除得分
    </button>
  );
  return (
    <div className="score-row">
      <b>维度得分</b>
      {score.blocker ? (
        <>
          <span className="hint">无法生成维度得分：{score.blocker}。</span>
          {score.missing && remove}
        </>
      ) : score.missing ? (
        <>
          <label className="inline">
            算分条件
            <select value={score.missing} onChange={(e) => onScore(score.group.id, e.target.value as ScoreMissing)}>
              {(Object.keys(SCORE_MISSING_LABELS) as ScoreMissing[]).map((rule) => (
                <option key={rule} value={rule}>
                  {SCORE_MISSING_LABELS[rule]}
                </option>
              ))}
            </select>
          </label>
          {remove}
        </>
      ) : (
        <>
          <button className="btn small" onClick={() => onScore(score.group.id, 'complete')}>
            生成维度得分
          </button>
          <span className="hint">各子题取均值，反向题先翻转。</span>
        </>
      )}
    </div>
  );
}

export function QuestionBody({ stat, bare, emptyHint }: { stat: Stat; bare?: boolean; emptyHint?: string }) {
  if (stat.n === 0) return <p className="empty">{emptyHint ?? '这道题没有有效回答，无法统计。可以把它改成「元数据」或直接忽略。'}</p>;
  const table = <DistributionTable stat={stat} />;
  const chart = <ChartFor stat={stat} />;
  const note = sampleNote(stat.n);
  return (
    <>
      {!bare && (
        <ul className="chips">
          {chips(stat).map(([k, v]) => (
            <li key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </li>
          ))}
        </ul>
      )}
      {chart || table ? (
        <div className={`card-body${chart ? '' : ' no-chart'}`}>
          {chart}
          <div>
            {note && <p className="sample-note">{note}。</p>}
            {table}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ThemeList({ result }: { result: AIResult }) {
  return (
    <div className="themes">
      {result.themes.map((t, i) => (
        <article className="theme" key={`${t.name}-${i}`}>
          <header>
            <h4>{t.name}</h4>
            <span className={`tag tag-${t.sentiment}`}>{SENTIMENT_LABELS[t.sentiment]}</span>
            <span className="theme-count">约 {t.count} 条</span>
          </header>
          {t.description && <p>{t.description}</p>}
          {t.quotes.length > 0 && (
            <ul className="quotes">
              {t.quotes.map((q, j) => (
                <li key={j}>“{q}”</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}

export function aiNote(result: AIResult) {
  return `主题和条数由 ${result.model} 估算，仅供参考；引文均逐字来自原始回答。送入模型 ${result.analyzed} / ${result.total} 条${result.sampled ? '（等距抽样）' : ''}，${formatDateTime(result.createdAt)}。`;
}

interface OpenTextProps {
  question: Question;
  stat?: Stat;
  result?: AIResult;
  hasKey: boolean;
  onOpenSettings: () => void;
  onRun: (q: Question) => Promise<void>;
}

export function OpenText({ question, stat, result, hasKey, onOpenSettings, onRun }: OpenTextProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setError('');
    setBusy(true);
    try {
      await onRun(question);
    } catch (e) {
      setError(e instanceof AIError ? e.message : '归纳失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  if (!stat || stat.kind !== 'open' || stat.n === 0) return null;

  return (
    <div className="open-block">
      {result ? (
        <div className="ai-result">
          <p className="ai-summary">{result.summary}</p>
          <ThemeList result={result} />
          <p className="ai-note">{aiNote(result)}</p>
          <div className="ai-actions">
            <button className="btn small" onClick={run} disabled={busy}>
              {busy ? '正在归纳…' : '重新归纳'}
            </button>
            <button className="btn small ghost" onClick={onOpenSettings}>
              更换模型
            </button>
          </div>
        </div>
      ) : (
        <div className="ai-start">
          <div className="ai-start-head">
            <h4>用 AI 归纳主题</h4>
            <span>{stat.n} 条回答，平均 {formatNumber(stat.avgChars, 0)} 字</span>
          </div>
          {!hasKey && (
            <p className="hint">
              还没有配置模型。回答只会发送到你配置的服务商。
            </p>
          )}
          <div className="samples">
            {stat.samples.map((s, i) => (
              <p key={i}>“{s}”</p>
            ))}
          </div>
          <div className="ai-actions">
            {hasKey ? (
              <button className="btn primary" onClick={run} disabled={busy}>
                {busy ? '正在归纳…' : '归纳主题'}
              </button>
            ) : (
              <button className="btn primary" onClick={onOpenSettings}>
                配置模型
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="alert">{error}</p>}
    </div>
  );
}

interface CardProps {
  index: number;
  question: Question;
  stat: Stat;
  onChangeType: (type: QuestionType) => void;
  onIgnore: () => void;
  onMerge?: () => void;
  // 派生题目（维度得分）：题型固定，不能忽略和合并，只能移除；note 是口径说明。
  locked?: boolean;
  onRemove?: () => void;
  note?: string;
  // 专业模式：在卡片上直接显示分布与缺失率。
  showDistribution?: boolean;
  showMissingRate?: boolean;
  children?: ReactNode;
}

export function QuestionCard({ index, question, stat, onChangeType, onIgnore, onMerge, locked, onRemove, note, showDistribution, showMissingRate, children }: CardProps) {
  return (
    <article className="card" id={`card-${index}`}>
      <header className="card-head">
        <h3>
          <span className="qno">{index + 1}</span>
          {question.title}
        </h3>
        <div className="card-tools">
          {locked ? (
            <span className="tag">维度得分</span>
          ) : (
            <>
              <label className="sr-only" htmlFor={`type-${index}`}>
                {question.title} 的题型
              </label>
              <select id={`type-${index}`} value={question.type} onChange={(e) => onChangeType(e.target.value as QuestionType)}>
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              {onMerge && (
                <button className="btn small ghost" onClick={onMerge}>
                  合并
                </button>
              )}
              <button className="btn small ghost" onClick={onIgnore}>
                忽略
              </button>
            </>
          )}
          {onRemove && (
            <button className="btn small ghost" onClick={onRemove}>
              移除
            </button>
          )}
        </div>
      </header>
      <p className="card-meta">
        {TYPE_LABELS[question.type]} · {locked ? `有效得分 ${stat.n} 份` : `有效回答 ${stat.n} 条`}
        {stat.missing > 0 ? ` · ${locked ? '没有得分' : '缺失'} ${stat.missing} 份` : ''}
        {showMissingRate && stat.missing > 0 && stat.n + stat.missing > 0 ? ` · 缺失率 ${formatPct(stat.missing / (stat.n + stat.missing))}` : ''}
      </p>
      {note && <p className="card-note">{note}</p>}
      {showDistribution && (stat.kind === 'scale' || stat.kind === 'numeric') && stat.shape && (
        <p className="card-meta dist-line">
          分布：偏度 {stat.shape.skew.toFixed(2)}（SE {stat.shape.skewSE.toFixed(2)}） · 峰度 {stat.shape.kurtosis.toFixed(2)}（SE {stat.shape.kurtosisSE.toFixed(2)}）
          {Math.abs(stat.shape.skew) > 1 || Math.abs(stat.shape.kurtosis) > 2 ? ' · 偏离正态，考虑秩检验' : ''}
        </p>
      )}
      <QuestionBody
        stat={stat}
        emptyHint={locked ? '按当前的算分条件，没有任何问卷得到得分：可以放宽条件，或先看子题有没有作答。' : undefined}
      />
      {children}
    </article>
  );
}
