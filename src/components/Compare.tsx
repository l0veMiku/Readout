import { useMemo } from 'react';
import type { Dataset, ProModeOptions, Question } from '../types.ts';
import { PRO_MODE_OFF, TYPE_LABELS } from '../types.ts';
import { canCompare, compareQuestions, formatTest } from '../lib/compare.ts';
import type { Comparison, Diff, MeanCell, TestResult } from '../lib/compare.ts';
import { CORRECTION_LABELS, withProMode } from '../lib/comparePro.ts';
import { GROUP_COLORS, dotIntervals } from '../lib/charts.ts';
import { sampleNote } from '../lib/stats.ts';
import { ciDigits, formatCI, formatNumber, formatP, formatPct, formatPctCI, formatRange } from '../lib/text.ts';
import { Chart } from './Chart.tsx';

export interface ComparisonPick {
  group: string;
  compare: string;
}

export const isGroupQuestion = (q: Question | undefined) => !!q && q.included && q.type === 'single';

export const pickStillValid = (dataset: Dataset, pick: ComparisonPick | null) => {
  if (!pick) return true;
  const g = dataset.questions.find((q) => q.id === pick.group);
  const c = dataset.questions.find((q) => q.id === pick.compare);
  return isGroupQuestion(g) && (pick.compare === '' || canCompare(g ?? null, c ?? null));
};

// 判定：专业模式给了校正后的判定就用它，否则看区间是否不含 0。
const isClear = (d: Diff) => d.clear ?? (d.lower > 0 || d.upper < 0);

const diffCell = (d: Diff | null, pct: boolean) => {
  if (!d) return <td className="cmp-diff">—</td>;
  const amount = (x: number) => (pct ? `${formatNumber(x * 100, 1)} 个百分点` : formatNumber(x, 2));
  const range = (x: number) => (pct ? formatNumber(x * 100, 1) : formatNumber(x, 2));
  return (
    <td className={`cmp-diff${isClear(d) ? ' clear' : ''}`}>
      <b>
        {d.diff > 0 ? '+' : ''}
        {amount(d.diff)}
      </b>
      <span className="ci">95% 区间 {formatRange(d.lower, d.upper, range)}</span>
      {!pct && (
        <span className="ci">
          {d.rankP !== undefined && d.rankP !== null
            ? `秩检验 p ${formatP(d.rankP)} · r ${d.rankR === null || d.rankR === undefined ? '—' : d.rankR.toFixed(2)}`
            : `${d.p === null ? '' : `p ${formatP(d.p)}`} · d ${d.d === null ? '—' : d.d.toFixed(2)}`}
        </span>
      )}
      {d.pAdjusted !== undefined && d.pAdjusted !== null && <span className="ci">校正后 p {formatP(d.pAdjusted)}</span>}
    </td>
  );
};

export function comparisonFor(dataset: Dataset, pick: ComparisonPick | null, rows: Record<string, string>[] = dataset.rows, pro: ProModeOptions = PRO_MODE_OFF) {
  if (!pick?.group || !pick.compare || !pickStillValid(dataset, pick)) return null;
  const g = dataset.questions.find((q) => q.id === pick.group);
  const c = dataset.questions.find((q) => q.id === pick.compare);
  const comparison = g && c ? compareQuestions(g, c, rows, { deferBootstrap: true, yates: pro.continuity }) : null;
  return comparison ? withProMode(comparison, pro) : null;
}

export function ComparisonBody({ comparison, inReport, pro = PRO_MODE_OFF }: { comparison: Comparison; inReport?: boolean; pro?: ProModeOptions }) {
  const block = inReport ? 'q-sec' : 'card';
  const H = inReport ? 'h3' : 'h2';
  const { groups, rows, mode, multi } = comparison;
  const shown = groups.length > 8 ? groups.map((_, i) => i).sort((a, b) => groups[b].n - groups[a].n).slice(0, 8) : groups.map((_, i) => i);
  const chartRows = mode === 'prop' ? rows.slice(0, 15) : rows;
  const medianRow = mode === 'mean' && rows[0].cells.some((c) => c.kind === 'mean' && c.median !== null);

  const chart = useMemo(() => {
    const labels = chartRows.map((r) => r.name);
    if (medianRow) labels.push('中位数');
    const series = shown.map((gi) => {
      const points = chartRows
        .map((r, i) => {
          const c = r.cells[gi];
          if (c.kind === 'mean' && c.mean === null) return null;
          return c.kind === 'prop'
            ? { row: i, value: c.pct, lower: c.ci?.lower ?? null, upper: c.ci?.upper ?? null }
            : { row: i, value: c.mean ?? 0, lower: c.meanCI?.lower ?? null, upper: c.meanCI?.upper ?? null };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);
      const cell = rows[0].cells[gi];
      if (medianRow && cell.kind === 'mean' && cell.median !== null) {
        points.push({ row: chartRows.length, value: cell.median, lower: cell.medianCI?.lower ?? null, upper: cell.medianCI?.upper ?? null });
      }
      return { name: groups[gi].name, points };
    });
    return dotIntervals(series, labels, mode === 'prop');
  }, [groups, rows, shown, chartRows, medianRow, mode]);

  const digits = (c: MeanCell) => ciDigits(c.mean);
  const notes = groups.filter((g) => sampleNote(g.n)).map((g) => `「${g.name}」${sampleNote(g.n)}`);
  if (multi) notes.push(comparison.adjust ? '各选项分别检验，p 值已做多重比较校正。' : '各选项分别检验，未做多重比较校正。');
  if (comparison.medianPending) notes.push('各组中位数的 95% 区间还在后台计算，算完后补上。');
  if (shown.length < groups.length) notes.push(`图中只画人数最多的 8 组，表格列出全部。`);
  if (chartRows.length < rows.length) notes.push(`图中只画人数最多的 ${chartRows.length} 个选项，表格列出全部。`);
  if (comparison.adjust) notes.push(`${CORRECTION_LABELS[comparison.adjust.method]} 校正：共 ${comparison.adjust.m} 处比较；表中区间未校正，加粗按校正后 p < 0.05。`);
  if (comparison.rank) notes.push('秩检验比较的是分布而不是均值；表中的均值差与区间仍按 Welch 法给出。');
  const withEffect = (test: TestResult) => {
    const text = formatTest(test);
    return pro.effectSize && test.effect !== null ? `${text}，Cramér's V = ${formatNumber(test.effect, 2)}` : text;
  };
  const tests = multi ? rows.flatMap((r) => (r.test ? [`「${r.name}」：${withEffect(r.test)}`] : [])) : comparison.test ? [withEffect(comparison.test)] : [];
  if (comparison.rank?.overall) {
    const o = comparison.rank.overall;
    tests.push(`Kruskal–Wallis H = ${formatNumber(o.h, 2)}，df = ${o.df}，p = ${formatP(o.p)}，ε² = ${formatNumber(o.epsilon2, 3)}（整体秩检验）`);
  }

  return (
    <>
      <section className={`${block} cmp-verdict`}>
        <H>结论</H>
        <p>{comparison.sentence}</p>
        {mode === 'prop' && rows.length > 0 && groups.length > 1 && (
          <ul className="cmp-lines">
            {rows.map((r) => (
              <li key={r.name}>{r.sentence}</li>
            ))}
          </ul>
        )}
      </section>

      {rows.length > 0 && (
        <section className={block}>
          <H>各组的「{comparison.compareTitle}」</H>
          <Chart option={chart.option} height={chart.height} />
        </section>
      )}

      {rows.length > 0 && (
        <section className={block}>
          <H>分组表</H>
          <p className="cmp-caption">
            基准组是「{groups[0].name}」（人数最多的一组）；差值 = 该组 − 基准组。区间不含 0 时加粗。
          </p>
          <div className="table-scroll">
            <table className="cmp">
              <thead>
                <tr>
                  <th>{multi ? '选项' : mode === 'prop' ? '选项' : '指标'}</th>
                  <th>分组</th>
                  <th>人数</th>
                  <th>{mode === 'prop' ? '占比' : '均值'}</th>
                  <th>95% 区间</th>
                  <th>相对基准组「{groups[0].name}」</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((row) =>
                  row.cells.map((cell, gi) => (
                    <tr key={`${row.name}-${gi}`}>
                      {gi === 0 && (
                        <td rowSpan={groups.length} className="cmp-name">
                          {row.name}
                        </td>
                      )}
                      <td>
                        <i className="cmp-dot" style={{ background: shown.includes(gi) ? GROUP_COLORS[shown.indexOf(gi) % GROUP_COLORS.length] : 'transparent' }} />
                        {groups[gi].name}
                      </td>
                      <td>{cell.kind === 'prop' ? cell.count : cell.n}</td>
                      <td>
                        {cell.kind === 'prop' ? formatPct(cell.pct) : formatNumber(cell.mean, digits(cell))}
                        {cell.kind === 'mean' && cell.median !== null && <span className="ci">中位数 {formatNumber(cell.median, digits(cell))}</span>}
                      </td>
                      <td>{cell.kind === 'prop' ? formatPctCI(cell.ci) : formatCI(cell.meanCI, digits(cell))}</td>
                      {gi === 0 ? <td className="cmp-diff">基准</td> : diffCell(row.diffs[gi - 1], mode === 'prop')}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          {(tests.length > 0 || notes.length > 0) && (
            <div className="cmp-notes">
              {tests.length > 0 && <p>检验：{tests.join('；')}</p>}
              {notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function ComparePage({ dataset, pick, notice, onSelect, comparison, pro = PRO_MODE_OFF }: { dataset: Dataset; pick: ComparisonPick | null; notice: string; onSelect: (pick: ComparisonPick) => void; comparison: Comparison | null; pro?: ProModeOptions }) {
  const groupOptions = dataset.questions.filter((q) => q.included);

  const label = (q: Question, role: 'group' | 'compare') => {
    const tag = TYPE_LABELS[q.type];
    if (role === 'group') return isGroupQuestion(q) && q.id !== pick?.compare ? `${q.title}（${tag}）` : `${q.title}（不可作为分组题）`;
    if (q.id === pick?.group) return `${q.title}（已作为分组题）`;
    return ['single', 'multi', 'scale', 'numeric'].includes(q.type) ? `${q.title}（${tag}）` : `${q.title}（开放题不可对比）`;
  };

  return (
    <div className="compare-wrap">
      <header className="work-head">
        <h1 className="page-title">交叉分析</h1>
        <div className="cmp-pickers">
          <label>
            <span>分组题</span>
            <select value={pick?.group ?? ''} onChange={(e) => onSelect({ group: e.target.value, compare: pick?.compare ?? '' })}>
              <option value="">选择一道单选题</option>
              {groupOptions.map((q) => (
                <option key={q.id} value={q.id} disabled={!isGroupQuestion(q) || q.id === pick?.compare}>
                  {label(q, 'group')}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>对比题</span>
            <select value={pick?.compare ?? ''} onChange={(e) => onSelect({ group: pick?.group ?? '', compare: e.target.value })}>
              <option value="">选择一道题</option>
              {groupOptions.map((q) => (
                <option key={q.id} value={q.id} disabled={q.id === pick?.group || !['single', 'multi', 'scale', 'numeric'].includes(q.type)}>
                  {label(q, 'compare')}
                </option>
              ))}
            </select>
          </label>
        </div>
        {notice && <p className="alert">{notice}</p>}
        {comparison && (
          <p className="work-meta">
            共 {comparison.n} 条记录同时有效回答了这两道题，分成 {comparison.groups.length} 组。
          </p>
        )}
        {comparison && pro.on && (comparison.adjust || comparison.rank || pro.effectSize) && (
          <p className="pro-strip">
            {comparison.adjust && <span>{comparison.adjust.method === 'holm' ? 'Holm' : 'BH'} 校正 · {comparison.adjust.m} 处</span>}
            {comparison.rank && <span>Mann–Whitney U / Kruskal–Wallis</span>}
            {pro.effectSize && <span>Cramér's V</span>}
            {comparison.adjust && <span>区间未校正</span>}
          </p>
        )}
      </header>
      {comparison ? (
        <ComparisonBody comparison={comparison} pro={pro} />
      ) : (
        <section className="card">
          <p className="empty">选好分组题和对比题后，这里会出现结论、各组图表和分组表。</p>
        </section>
      )}
    </div>
  );
}
