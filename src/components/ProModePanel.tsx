import type { ProModeOptions } from '../types.ts';
import { PRO_MODE_OFF, PRO_MODE_ON } from '../types.ts';

interface RowProps {
  checked: boolean;
  onToggle: () => void;
  title: string;
  why: string;
  children?: React.ReactNode;
}

function Row({ checked, onToggle, title, why, children }: RowProps) {
  return (
    <div className="pro-row">
      <label className="inline">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span>{title}</span>
      </label>
      {children}
      <details className="pro-why">
        <summary>说明</summary>
        <p>{why}</p>
      </details>
    </div>
  );
}

// 报告页的专业模式面板：开关 + A 档 + B 档，每一项都能展开看“为什么用 / 什么时候不该用”。
export function ProModePanel({ pro, onChange }: { pro: ProModeOptions; onChange: (next: ProModeOptions) => void }) {
  const set = <K extends keyof ProModeOptions>(key: K, value: ProModeOptions[K]) => onChange({ ...pro, [key]: value });
  const toggle = (key: 'effectSize' | 'alphaCI' | 'distribution' | 'missingTable' | 'apaTables' | 'spearman' | 'rankTest' | 'scoreForms' | 'factorCheck') => set(key, !pro[key]);

  return (
    <section className="card pro-panel">
      <header className="pro-head">
        <label className="inline pro-switch">
          <input type="checkbox" checked={pro.on} onChange={(e) => onChange(e.target.checked ? PRO_MODE_ON : PRO_MODE_OFF)} />
          <span>专业模式</span>
        </label>
        <span className="hint">论文口径：多重比较校正、效应量、分布描述与非参数检验。关闭时所有数字回到默认口径，报告与现在完全一致。</span>
      </header>
      {pro.on && (
        <div className="pro-groups">
          <details className="pro-group" open>
            <summary>A 档 · 基础论文口径</summary>
            <Row
              checked={pro.correction !== null}
              onToggle={() => set('correction', pro.correction === null ? 'holm' : null)}
              title="多重比较校正"
              why="同时做很多次检验时 p 值会偏乐观。Holm 控制族错误率（更保守），Benjamini–Hochberg 控制错误发现率（较宽松）。校正只改“是否算明确差别”的判定，表中区间仍是未校正的。"
            >
              {pro.correction !== null && (
                <select value={pro.correction} onChange={(e) => set('correction', e.target.value as 'holm' | 'bh')} aria-label="校正方法">
                  <option value="holm">Holm</option>
                  <option value="bh">Benjamini–Hochberg</option>
                </select>
              )}
            </Row>
            <Row
              checked={pro.effectSize}
              onToggle={() => toggle('effectSize')}
              title="卡方效应量 Cramér's V"
              why="卡方只回答“有没有关系”，Cramér's V 回答“关系多大”：常用参考 0.1 小、0.3 中、0.5 大。2×2 表时等于 φ；小样本（不少格子期望频数小于 5）时仅供参考。"
            />
            <Row
              checked={pro.alphaCI}
              onToggle={() => toggle('alphaCI')}
              title="α 的 95% 区间"
              why="α 也是抽样得到的，用 Bootstrap 给区间（2000 次重抽样、固定种子、可复现，与数值题的区间同一套）。完整作答不足 5 份时不给。"
            />
            <Row
              checked={pro.distribution}
              onToggle={() => toggle('distribution')}
              title="偏度、峰度与缺失率表"
              why="偏度/峰度及其标准误用来判断是否明显偏离正态、该不该考虑秩检验；缺失率表逐题列出有效回答、缺失份数与缺失率。有效回答不足 8 条时不给偏度/峰度。"
            />
            <Row
              checked={pro.apaTables}
              onToggle={() => toggle('apaTables')}
              title="三线表与论文数值格式"
              why="表格改成三线表，数值写成 M = 3.16，SD = 0.87，95% CI [3.02, 3.34]，可以直接贴进论文；关闭后回到叙述式写法。"
            />
          </details>
          <details className="pro-group">
            <summary>B 档 · 进阶</summary>
            <Row
              checked={pro.spearman}
              onToggle={() => toggle('spearman')}
              title="Spearman 秩相关"
              why="基于秩的相关，适合有序量表或明显非正态的数据；取值重复较多时 p 值是近似（与 R 的做法一致）。只影响相关分析页。"
            />
            <Row
              checked={pro.rankTest}
              onToggle={() => toggle('rankTest')}
              title="秩检验（Mann–Whitney U / Kruskal–Wallis）"
              why="用各组相对基准组的 Mann–Whitney U 和整体的 Kruskal–Wallis 替代 Welch；比较的是分布而不是均值，报告效应量 r 与 ε²。不会自动切换，由你决定用哪种。"
            />
            <Row
              checked={pro.scoreForms}
              onToggle={() => toggle('scoreForms')}
              title="得分形式：求和 / z 分"
              why="得分卡片上可以选择均值（默认）、求和或 z 分。z 分按计入分析的问卷做样本标准化，清洗规则一变数字就会变。"
            />
            <Row
              checked={pro.factorCheck}
              onToggle={() => toggle('factorCheck')}
              title="KMO、Bartlett 与单因子 ω"
              why="因子分析前的适用性检验。样本少于变量数 5 倍时指标仅供参考；ω 用第一主成分载荷近似，依赖单因子假设，题组明显多维时以 α 为准。"
            />
          </details>
        </div>
      )}
    </section>
  );
}
