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
  const boxRows = useMemo(() => {
    if (!pro.on) return [];
    return items.flatMap((item) =>
      (item.kind === 'question' ? [item.question] : item.questions)
        .filter((q) => q.type === 'scale' || q.type === 'numeric')
        .flatMap((q) => {
          const five = fiveNumbers(boxValues(q, rows));
          return five ? [{ name: q.subTitle ?? q.title, ...five }] : [];
        }),
    );
  }, [items, rows, pro.on]);

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
        <p className="work-meta">
          把专业模式的检查集中在一页：先看问题清单，再逐项查看缺失、分布、信度与维度、相关。每条都能跳到工作台对应卡片去改。
        </p>
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
              ['样本', String(dataset.rows.length), valid < dataset.rows.length ? `有效 ${valid} 份` : '全部计入分析'],
              ['需处理 / 注意', String(problems), problems === 0 ? '没有需要处理的问题' : '按严重度排序，见下方清单'],
              ['缺失超过 10%', String(worstMissing), `${diagnostics.missing.length} 道题参与检查`],
              ['题组', String(diagnostics.groups.length), diagnostics.groups.length ? '信度与因子前置检验' : '还没有题组'],
            ].map(([k, v, note]) => (
              <div className="stat-card" key={k}>
                <span>{k}</span>
                <b>{v}</b>
                <small>{note}</small>
              </div>
            ))}
          </section>

          <section className="card">
            <h2>问题清单</h2>
            {diagnostics.issues.length === 0 ? (
              <p className="empty">没有发现明显问题。仍然建议在报告里核对缺失率与方法说明。</p>
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
            <p className="hint">缺失率的分子是缺失份数，分母是有效回答 + 缺失份数；跳题逻辑会让这道题的缺失偏高，先确认再处理。</p>
          </section>

          <section className="card">
            <h2>分布</h2>
            {boxRows.length > 0 && (
              <Suspense fallback={<p className="chart-placeholder" style={{ height: boxRows.length * 36 + 56 }}>图表加载中…</p>}>
                <BoxChartLazy rows={boxRows} />
              </Suspense>
            )}
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
            <p className="hint">偏度、峰度按 type 2 公式（与 SPSS 默认一致）；箱线图按五个数绘制。</p>
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
                <p className="hint">
                  变量与「相关分析」页共用选择：{corr.variables.length} 个变量、{corr.pairs.length} 对。色带为 R 常用的 RdBu（0 为白）；对角线为 1，已留空。
                </p>
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
