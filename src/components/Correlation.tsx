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

export function CorrBody({ corr, inReport }: { corr: Correlation; inReport?: boolean }) {
  const { variables, pairs } = corr;
  const m = variables.length;
  const block = inReport ? 'q-sec' : 'card';
  const notes = [
    '95% 区间不含 0 的系数加粗。',
    `${m} 个变量两两检验，共 ${pairs.length} 对，未做多重比较校正。`,
    '每一对只用两者都有作答的问卷（成对删除）。',
  ];
  if (pairs.some((p) => p.r !== null && !p.ci)) notes.push('成对样本只有 3 份的变量对不显示区间：Fisher z 需要 4 份以上。');
  return (
    <section className={block}>
      <p className="cmp-verdict">{corr.sentence}</p>
      <div className="table-scroll">
        <table className="cmp corr-matrix">
          <thead>
            <tr>
              <th>变量</th>
              {variables.map((q) => (
                <th key={q.id} className="corr-col">
                  {varLabel(q)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {variables.map((row, i) => (
              <tr key={row.id}>
                <th scope="row" className="corr-name">
                  {varLabel(row)}
                </th>
                {variables.map((col, j) => {
                  if (i === j) {
                    return (
                      <td key={col.id} className="corr-self">
                        —
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
      <div className="table-scroll">
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
            {pairs.map((p, i) => (
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
      </div>
      <div className="cmp-notes">
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
  corr,
}: {
  dataset: Dataset;
  selected: string[];
  onToggle: (id: string) => void;
  corr: Correlation | null;
}) {
  const options = dataset.questions.filter((q) => isCorrQuestion(q));
  const chosen = selectedVars(dataset, selected).length;
  return (
    <div className="compare-wrap">
      <header className="cmp-head">
        <h2>相关分析</h2>
        <p className="empty">
          从左边的数值题、量表题和维度得分里选两个以上，看两两之间的 Pearson 相关系数。每一对只用两者都有作答的问卷，
          区间用 Fisher z 变换；区间不含 0 的系数加粗。
        </p>
      </header>
      <div className="corr-layout">
        <aside className="corr-pick">
          <p className="corr-pick-title">变量（已选 {chosen} 个）</p>
          <ul>
            {options.map((q) => (
              <li key={q.id}>
                <label>
                  <input type="checkbox" checked={selected.includes(q.id)} onChange={() => onToggle(q.id)} />
                  <span>{varLabel(q)}</span>
                  <em>{varTag(q)}</em>
                </label>
              </li>
            ))}
          </ul>
        </aside>
        <div className="corr-result">
          {corr ? <CorrBody corr={corr} /> : <p className="empty">{chosen === 0 ? '还没有选变量。' : '至少选两个变量才会出结果。'}</p>}
        </div>
      </div>
    </div>
  );
}
