import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AIError, SENTIMENT_LABELS } from '../lib/ai.ts';
import type { OptionRow, Stat } from '../lib/stats.ts';
import { sampleNote, withCI, withPctCI } from '../lib/stats.ts';
import { horizontalBars, meanIntervals, verticalBars } from '../lib/charts.ts';
import { ciDigits, formatCI, formatDateTime, formatNumber, formatPct, formatPctCI } from '../lib/text.ts';
import { QUESTION_TYPES, TYPE_LABELS } from '../types.ts';
import type { AIResult, Question, QuestionGroup, QuestionType } from '../types.ts';
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
  const built = useMemo(() => {
    if (stat.kind === 'single' || stat.kind === 'multi') return stat.options.length ? horizontalBars(stat.options) : null;
    if (stat.kind === 'scale') return stat.levels.length ? verticalBars(stat.levels, { mean: stat.numeric ? stat.mean : null }) : null;
    // 文本量表按类别轴画分布，均值只出现在结论句和指标里。
    if (stat.kind === 'numeric') return stat.bins.length ? verticalBars(stat.bins, { rotate: true }) : null;
    return null;
  }, [chartKey]);
  if (!built) return null;
  return <Chart option={built.option} height={built.height} />;
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
        : [
            ['均值', formatNumber(stat.mean, 2)],
            ['95% 区间', formatCI(stat.meanCI, 2)],
            ['中位数', formatNumber(stat.median, 2)],
            ['标准差', formatNumber(stat.sd, 2)],
            ...(stat.top2 !== null ? ([['Top-2 占比', formatPct(stat.top2)]] as [string, string][]) : []),
          ];
    case 'numeric':
      return stat.mean === null
        ? []
        : [
            ['均值', smartNumber(stat.mean)],
            ['95% 区间', stat.ciPending ? '计算中' : formatCI(stat.meanCI, ciDigits(stat.mean))],
            ['中位数', smartNumber(stat.median)],
            ['标准差', smartNumber(stat.sd)],
            ['范围', `${smartNumber(stat.min)} – ${smartNumber(stat.max)}`],
          ];
    case 'open':
      return [['平均字数', formatNumber(stat.avgChars, 0)]];
  }
}

export function sentence(stat: Stat) {
  const head = `有效回答 ${stat.n} 条${stat.missing > 0 ? `（缺失 ${stat.missing}）` : ''}`;
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
  const note = sampleNote(stat.n);
  return `${head}${parts.length ? `；${parts.join('，')}` : ''}。${note ? `${note}。` : ''}`;
}

function DistributionTable({ stat }: { stat: Stat }) {
  const rows = stat.kind === 'single' || stat.kind === 'multi' ? stat.options : stat.kind === 'scale' ? stat.levels : null;
  if (rows) {
    return (
      <table className="dist">
        <thead>
          <tr>
            <th>选项</th>
            <th>人数</th>
            <th>占比</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
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

export function GroupBody({ questions, stats }: { questions: Question[]; stats: Record<string, Stat> }) {
  const rows = questions.flatMap((q) => (stats[q.id] ? [{ q, stat: stats[q.id] }] : []));
  const means: { name: string; value: number; ci: { lower: number; upper: number } | null }[] = [];
  for (const { q, stat } of rows) {
    if ((stat.kind === 'scale' || stat.kind === 'numeric') && stat.mean !== null) means.push({ name: q.subTitle ?? q.title, value: stat.mean, ci: stat.meanCI });
  }
  const chart = means.length >= 2 ? meanIntervals(means) : null;
  return (
    <>
      {chart && (
        <div className="group-chart">
          <Chart option={chart.option} height={chart.height} />
        </div>
      )}
      {rows.some(({ stat }) => sampleNote(stat.n)) && <p className="sample-note">部分子项的有效回答不足 30 条，均值和区间较宽。</p>}
      <table className="dist group-table">
        <thead>
          <tr>
            <th>子项</th>
            <th>有效回答</th>
            <th>概况</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ q, stat }) => (
            <tr key={q.id}>
              <td>
                {q.subTitle ?? q.title}
                <span className="group-type">{TYPE_LABELS[q.type]}</span>
              </td>
              <td>{stat.n}</td>
              <td>{groupStatText(stat)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  onChangeType: (type: QuestionType) => void;
  onIgnore: () => void;
  onSplit: () => void;
}

export function GroupCard({ index, group, questions, stats, onChangeType, onIgnore, onSplit }: GroupCardProps) {
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
      <GroupBody questions={questions} stats={stats} />
    </article>
  );
}

export function QuestionBody({ stat, bare }: { stat: Stat; bare?: boolean }) {
  if (stat.n === 0) return <p className="empty">这道题没有有效回答，无法统计。可以把它改成「元数据」或直接忽略。</p>;
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
              还没有配置模型。使用你自己的 API Key（OpenAI 兼容接口），回答只会发送到你配置的服务商。
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
  children?: ReactNode;
}

export function QuestionCard({ index, question, stat, onChangeType, onIgnore, onMerge, children }: CardProps) {
  return (
    <article className="card" id={`card-${index}`}>
      <header className="card-head">
        <h3>
          <span className="qno">{index + 1}</span>
          {question.title}
        </h3>
        <div className="card-tools">
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
        </div>
      </header>
      <p className="card-meta">
        {TYPE_LABELS[question.type]} · 有效回答 {stat.n} 条{stat.missing > 0 ? ` · 缺失 ${stat.missing}` : ''}
      </p>
      <QuestionBody stat={stat} />
      {children}
    </article>
  );
}
