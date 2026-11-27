import { startTransition, useMemo, useState } from 'react';
import type { Dataset, Question } from '../types.ts';
import { TYPE_LABELS } from '../types.ts';
import { isCorrQuestion } from '../lib/correlation.ts';
import type { Correlation, CorrPair } from '../lib/correlation.ts';
import { formatCI, formatNumber, formatP } from '../lib/text.ts';

const excludesZero = (p: CorrPair) => !!p.ci && (p.ci.lower > 0 || p.ci.upper < 0);

export const varLabel = (q: Question) => q.subTitle ?? q.title;

export const varTag = (q: Question) => (q.derived ? '维度得分' : TYPE_LABELS[q.type]);

export const selectedVars = (dataset: Dataset, ids: string[]) =>
  ids.flatMap((id) => {
    const q = dataset.questions.find((v) => v.id === id);
    return isCorrQuestion(q) ? [q as Question] : [];
  });

// pairs 按变量顺序两两排列，(i, j) 在其中的下标。
const pairIndex = (m: number, i: number, j: number) => (i * (2 * m - i - 1)) / 2 + (j - i - 1);

const PAGE = 100;

export function CorrBody({ corr, inReport }: { corr: Correlation; inReport?: boolean }) {
  const { variables, counts, pairs } = corr;
  // 报告里直接展开；页面上按次展开，表格只在展开时构建，变量多时首屏也更轻。
  const [expanded, setExpanded] = useState(!!inReport);
  // 行多的表先让箭头和按钮立刻响应，再把表格挂上去。
  const [rowsShown, setRowsShown] = useState(!!inReport);
  // 一次最多挂 100 行，其余点「显示更多」，避免一次选中几十个变量时卡住。
  const [limit, setLimit] = useState(PAGE);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    setRowsShown(false);
    if (next) startTransition(() => setRowsShown(true));
  };
  const m = variables.length;
  const shown = inReport ? pairs : pairs.slice(0, Math.min(limit, pairs.length));
  const block = inReport ? 'q-sec' : 'card';
  const notes = [
    '95% 区间不含 0 的系数加粗。',
    `${m} 个变量两两检验，共 ${pairs.length} 对，未做多重比较校正。`,
    '每一对只用两者都有作答的问卷（成对删除）；对角线是各变量的有效样本量。',
  ];
  if (pairs.some((p) => p.r !== null && !p.ci)) notes.push('成对样本只有 3 份的变量对不显示区间：Fisher z 需要 4 份以上。');
  // 展开/收起明细时矩阵不重建：几十个变量时矩阵有上千个格子，重建一下就是一次明显卡顿。
  const matrix = useMemo(
    () => (
      <div className="table-scroll">
        <table className="cmp corr-matrix">
          <thead>
            <tr>
              <th className="corr-corner">变量</th>
              {variables.map((q, i) => (
                <th key={q.id} className="corr-col" title={`${i + 1}. ${varLabel(q)}`}>
                  <i className="var-badge">{i + 1}</i>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {variables.map((row, i) => (
              <tr key={row.id}>
                <th scope="row" className="corr-name">
                  <i className="var-badge">{i + 1}</i>
                  <span>{varLabel(row)}</span>
                </th>
                {variables.map((col, j) => {
                  if (i === j) {
                    return (
                      <td key={col.id} className="corr-self" title="这道题的有效样本量">
                        <b>{counts[i]}</b>
                        <span className="ci">有效 n</span>
                      </td>
                    );
                  }
                  const p = pairs[pairIndex(m, Math.min(i, j), Math.max(i, j))];
                  if (p.r === null) {
                    return (
                      <td key={col.id} className="corr-na">
                        —<span className="ci">{p.blocker}</span>
                      </td>
                    );
                  }
                  return (
                    <td key={col.id} className={excludesZero(p) ? 'clear' : ''}>
                      <b>{formatNumber(p.r, 2)}</b>
                      <span className="ci">{p.ci ? formatCI(p.ci, 2) : '样本不足 4 份'}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    [variables, counts, pairs, m],
  );
  return (
    <section className={block}>
      <div className="cmp-verdict">
        <p>{corr.sentence}</p>
      </div>
      {matrix}
      <div className="corr-pairs">
        <button type="button" className="corr-pairs-toggle" aria-expanded={expanded} onClick={toggle}>
          <svg className={`chev${expanded ? ' open' : ''}`} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>每对的成对样本量、r、95% 区间与 p 值</span>
          <em>{pairs.length} 对</em>
        </button>
        {expanded && rowsShown && (
          <div className={`table-scroll corr-pairs-body${inReport ? '' : ' scroll'}`}>
            <table className="cmp">
              <thead>
                <tr>
                  <th>变量 A</th>
                  <th>变量 B</th>
                  <th>成对样本量</th>
                  <th>r</th>
                  <th>95% 区间</th>
                  <th>p</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p, i) => (
                  <tr key={i}>
                    <td className="cmp-name">{p.a}</td>
                    <td>{p.b}</td>
                    <td>{p.n}</td>
                    {p.r === null ? (
                      <td colSpan={3} className="corr-na">
                        —<span className="ci">{p.blocker}</span>
                      </td>
                    ) : (
                      <>
                        <td className={excludesZero(p) ? 'corr-bold' : ''}>{formatNumber(p.r, 2)}</td>
                        <td>{p.ci ? formatCI(p.ci, 2) : '—'}</td>
                        <td>{formatP(p.p ?? 1)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!inReport && shown.length < pairs.length && (
              <div className="corr-more">
                <button type="button" className="btn small ghost" onClick={() => startTransition(() => setLimit((v) => v + PAGE))}>
                  再显示 {Math.min(PAGE, pairs.length - shown.length)} 对
                </button>
                <span className="hint">
                  已列出 {shown.length} / {pairs.length} 对，报告里收录全部。
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="cmp-notes corr-notes">
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </div>
    </section>
  );
}

export function CorrelationPage({
  dataset,
  selected,
  onToggle,
  onClear,
  corr,
}: {
  dataset: Dataset;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  corr: Correlation | null;
}) {
  const options = dataset.questions.filter((q) => isCorrQuestion(q));
  const chosen = selectedVars(dataset, selected).length;
  return (
    <div className="corr-wrap">
      <header className="cmp-head">
        <h2>相关分析</h2>
        <p className="empty">
          从左边的数值题、量表题和维度得分里选两个以上，看两两之间的 Pearson 相关系数。每一对只用两者都有作答的问卷，
          区间用 Fisher z 变换；区间不含 0 的系数加粗。
        </p>
      </header>
      <div className="corr-layout">
        <aside className="corr-pick">
          <div className="corr-pick-head">
            <p className="corr-pick-title">变量（已选 {chosen} 个）</p>
            {chosen > 0 && (
              <button type="button" className="link" onClick={onClear}>
                清空
              </button>
            )}
          </div>
          <ul>
            {options.map((q) => {
              const at = selected.indexOf(q.id);
              return (
                <li key={q.id} className={at >= 0 ? 'on' : ''}>
                  <label>
                    <input type="checkbox" checked={at >= 0} onChange={() => onToggle(q.id)} />
                    <span>{varLabel(q)}</span>
                    <em>{varTag(q)}</em>
                    {at >= 0 && <i className="var-badge">{at + 1}</i>}
                  </label>
                </li>
              );
            })}
          </ul>
        </aside>
        <div className="corr-result">
          {corr ? (
            <CorrBody corr={corr} />
          ) : (
            <div className="card corr-empty">
              <p>{chosen === 0 ? '还没有选变量。' : '至少选两个变量才会出结果。'}</p>
              <p className="hint">勾选左边的复选框开始；每对变量只用两者都有作答的问卷，样本量写在结果里。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
