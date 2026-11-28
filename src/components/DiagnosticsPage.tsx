import { Suspense, lazy, useMemo } from 'react';
import type { Dataset, ProModeOptions, Question } from '../types.ts';
import type { CardItem } from '../lib/groups.ts';
import type { Correlation } from '../lib/correlation.ts';
import { corrValue } from '../lib/correlation.ts';
import type { Diagnostics, IssueLevel } from '../lib/diagnostics.ts';
import { LEVEL_LABELS, fiveNumbers, kmoBand } from '../lib/diagnostics.ts';
import { formatCI, formatNumber, formatP, formatPct } from '../lib/text.ts';
// 箱线图与热图单独拆 chunk：打开诊断页时才加载这两个图表类型。
const BoxChartLazy = lazy(() => import('./BoxChartLazy.tsx'));
const HeatChartLazy = lazy(() => import('./HeatChartLazy.tsx'));

interface DiagnosticsPageProps {
  dataset: Dataset;
  items: CardItem[];
  rows: Record<string, string>[];
  diagnostics: Diagnostics;
  corr: Correlation | null;
  pro: ProModeOptions;
  valid: number;
  onJump: (cardIndex: number) => void;
  onOpenPro: () => void;
  onGoCorrelation: () => void;
}

const levelClass: Record<IssueLevel, string> = { alert: 'issue-alert', warn: 'issue-warn', info: 'issue-info' };

function Jump({ index, onJump }: { index: number; onJump: (i: number) => void }) {
  return (
    <button type="button" className="link" onClick={() => onJump(index)}>
      查看
    </button>
  );
}

function boxValues(q: Question, rows: Record<string, string>[]) {
  return rows.map((r) => corrValue(q, r[q.id])).filter((v): v is number => v !== null);
}

export function DiagnosticsPage({ dataset, items, rows, diagnostics, corr, pro, valid, onJump, onOpenPro, onGoCorrelation }: DiagnosticsPageProps) {
  const problems = diagnostics.issues.filter((i) => i.level !== 'info').length;
  const worstMissing = diagnostics.missing.filter((m) => m.rate > 0.1).length;

  // 只准备数据；画图交给懒加载的 BoxChartLazy。
  type AuditBox = { name: string; min: number; q1: number; median: number; q3: number; max: number; span: number; lo: number; hi: number; key: number };
  const boxRows = useMemo<AuditBox[]>(() => {
    if (!pro.on) return [];
    return items.flatMap((item) =>
      (item.kind === 'question' ? [item.question] : item.questions)
        .filter((q) => q.type === 'scale' || q.type === 'numeric')
        .flatMap((q) => {
          const five = fiveNumbers(boxValues(q, rows));
          if (!five) return [];
          const iqr = five.q3 - five.q1;
          const span = five.max - five.min;
          // 箱线图按 Tukey 的 1.5×IQR 收须，极端值不把整张图的坐标轴拉长。
          return [
            {
              name: q.subTitle ?? q.title,
              min: Math.max(five.min, five.q1 - 1.5 * iqr),
              q1: five.q1,
              median: five.median,
              q3: five.q3,
              max: Math.min(five.max, five.q3 + 1.5 * iqr),
              span,
              lo: five.min,
              hi: five.max,
              key: Math.floor(Math.log10(Math.max(span, 2))),
            },
          ];
        }),
    );
  }, [items, rows, pro.on]);

  // 量表（1–5）和数值题（0–100000）不能共用一根坐标轴：按取值范围分组，每组单独一张箱线图。
  const boxGroups = useMemo(() => {
    const map = new Map<number, AuditBox[]>();
    for (const row of boxRows) map.set(row.key, [...(map.get(row.key) ?? []), row]);
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([key, list]) => ({ key, rows: list, lo: Math.min(...list.map((r) => r.lo)), hi: Math.max(...list.map((r) => r.hi)) }));
  }, [boxRows]);

  const heatData = useMemo(() => {
    if (!pro.on || !corr) return null;
    const labels = corr.variables.map((q) => q.subTitle ?? q.title);
    const n = labels.length;
    const matrix: (number | null)[][] = labels.map((_, i) => labels.map((__, j) => (i === j ? 1 : null)));
    // pairs 与变量同序（i < j 两两排列），按同样顺序回填。
    let k = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const r = corr.pairs[k++]?.r ?? null;
        matrix[i][j] = r;
        matrix[j][i] = r;
      }
    }
    return { labels, matrix };
  }, [corr, pro.on]);

  return (
    <div className="compare-wrap">
      <header className="work-head">
        <h1 className="page-title">数据诊断</h1>
      </header>

      {!pro.on ? (
        <section className="card">
          <p className="empty">数据诊断使用专业模式的指标（缺失、分布、KMO、ω 等），先打开专业模式。</p>
          <p style={{ textAlign: 'center' }}>
            <button type="button" className="btn primary" onClick={onOpenPro}>
              打开专业模式
            </button>
          </p>
        </section>
      ) : (
        <>
          <section className="stat-cards">
            {[
              ['样本', String(dataset.rows.length), valid < dataset.rows.length ? `有效 ${valid} 份` : ''],
              ['需处理 / 注意', String(problems), problems === 0 ? '没有' : ''],
              ['缺失超过 10%', String(worstMissing), ''],
              ['题组', String(diagnostics.groups.length), ''],
            ].map(([k, v, note]) => (
              <div className="stat-card" key={k}>
                <span>{k}</span>
                <b>{v}</b>
                {note && <small>{note}</small>}
              </div>
            ))}
          </section>

          <section className="card">
            <h2>问题清单</h2>
            {diagnostics.issues.length === 0 ? (
              <p className="empty">没有发现明显问题。</p>
            ) : (
              <ul className="issue-list">
                {diagnostics.issues.map((issue, i) => (
                  <li key={`${issue.title}-${i}`} className={levelClass[issue.level]}>
                    <span className="issue-level">{LEVEL_LABELS[issue.level]}</span>
                    <div>
                      <b>{issue.title}</b>
                      <p>{issue.detail}</p>
                    </div>
                    {issue.cardIndex !== null && <Jump index={issue.cardIndex} onJump={onJump} />}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>缺失</h2>
            <div className="table-scroll">
              <table className="dist">
                <thead>
                  <tr>
                    <th>题目</th>
                    <th>有效</th>
                    <th>缺失</th>
                    <th>缺失率</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.missing.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{m.n}</td>
                      <td>{m.missing}</td>
                      <td className={m.rate > 0.2 ? 'bad' : m.rate > 0.1 ? 'warn' : ''}>{formatPct(m.rate)}</td>
                      <td>
                        <span className="bar-track" aria-hidden="true">
                          <span className={m.rate > 0.2 ? 'bar-fill bad' : 'bar-fill'} style={{ width: `${Math.min(100, m.rate * 100)}%` }} />
                        </span>
                        <Jump index={m.cardIndex} onJump={onJump} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>分布</h2>
            {boxGroups.map((g) => (
              <div className="box-group" key={g.key}>
                {boxGroups.length > 1 && (
                  <p className="chart-note">
                    取值 {String(Number(g.lo.toFixed(2)))}–{String(Number(g.hi.toFixed(2)))} · {g.rows.length} 个变量
                  </p>
                )}
                <Suspense fallback={<p className="chart-placeholder" style={{ height: g.rows.length * 36 + 56 }}>图表加载中…</p>}>
                  <BoxChartLazy rows={g.rows} />
                </Suspense>
              </div>
            ))}
            <div className="table-scroll">
              <table className="dist">
                <thead>
                  <tr>
                    <th>变量</th>
                    <th>n</th>
                    <th>偏度（SE）</th>
                    <th>峰度（SE）</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {diagnostics.shapes.length === 0 ? (
                    <tr>
                      <td colSpan={5}>有效回答不足 8 条，或没有量表/数值题，暂不做分布描述。</td>
                    </tr>
                  ) : (
                    diagnostics.shapes.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>{s.n}</td>
                        <td className={Math.abs(s.skew) > 1 ? 'warn' : ''}>
                          {s.skew.toFixed(2)}（{s.skewSE.toFixed(2)}）
                        </td>
                        <td className={Math.abs(s.kurtosis) > 2 ? 'warn' : ''}>
                          {s.kurtosis.toFixed(2)}（{s.kurtosisSE.toFixed(2)}）
                        </td>
                        <td>
                          <Jump index={s.cardIndex} onJump={onJump} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>信度与维度</h2>
            {diagnostics.groups.length === 0 ? (
              <p className="empty">还没有题组。把同一维度的题目合并成题组后，这里会出现 α、KMO 与 ω。</p>
            ) : (
              <div className="table-scroll">
                <table className="dist">
                  <thead>
                    <tr>
                      <th>题组</th>
                      <th>完整作答</th>
                      <th>α（95% 区间）</th>
                      <th>KMO</th>
                      <th>Bartlett</th>
                      <th>ω</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {diagnostics.groups.map((g) => (
                      <tr key={g.id}>
                        <td>{g.title}</td>
                        <td>{g.complete ?? '—'}</td>
                        <td>
                          {g.alpha === null ? '—' : `${g.alpha.toFixed(3)}${g.alphaCI ? `（${formatCI(g.alphaCI, 3)}）` : ''}`}
                        </td>
                        <td>
                          {g.kmo === null ? '—' : `${g.kmo.toFixed(3)}（${kmoBand(g.kmo)}）`}
                        </td>
                        <td>
                          {g.bartlett
                            ? `χ² ${formatNumber(g.bartlett.chi2, 2)}，df ${g.bartlett.df}，${g.bartlett.p < 0.001 ? 'p < 0.001' : `p ${formatP(g.bartlett.p)}`}`
                            : '—'}
                        </td>
                        <td>{g.omega === null ? '—' : g.omega.toFixed(3)}</td>
                        <td>
                          <Jump index={g.cardIndex} onJump={onJump} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {diagnostics.groups.flatMap((g) => g.notes.map((n) => `${g.title}：${n}`)).map((n) => (
              <p className="hint" key={n}>
                {n}
              </p>
            ))}
          </section>

          <section className="card">
            <h2>相关</h2>
            {corr && heatData ? (
              <>
                <p className="cmp-caption">{corr.sentence}</p>
                <Suspense fallback={<p className="chart-placeholder" style={{ height: heatData.labels.length * 34 + 34 }}>图表加载中…</p>}>
                  <HeatChartLazy labels={heatData.labels} matrix={heatData.matrix} />
                </Suspense>
              </>
            ) : (
              <p className="empty">
                先在「相关分析」里选两个以上变量，这里会显示相关热图。
                <button type="button" className="link" onClick={onGoCorrelation}>
                  去选变量
                </button>
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
