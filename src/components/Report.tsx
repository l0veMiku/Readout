import { memo } from 'react';
import type { AIResult, Dataset, ProModeOptions } from '../types.ts';
import { TYPE_LABELS } from '../types.ts';
import type { Stat } from '../lib/stats.ts';
import { validRowCount } from '../lib/stats.ts';
import { includedItems } from '../lib/groups.ts';
import { formatDateTime, formatPct } from '../lib/text.ts';
import type { ReliabilityExtras } from '../lib/reliabilityExtras.ts';
import { CORRECTION_LABELS } from '../lib/comparePro.ts';
import { GroupBody, QuestionBody, ThemeList, aiNote, sentence } from './QuestionView.tsx';
import { ComparisonBody } from './Compare.tsx';
import type { Comparison } from '../lib/compare.ts';
import type { Reliability } from '../lib/reliability.ts';
import { cleaningSentence } from '../lib/cleaning.ts';
import type { CleaningSummary } from '../lib/cleaning.ts';
import { scoreNote } from '../lib/scores.ts';
import { CorrBody } from './Correlation.tsx';
import type { Correlation } from '../lib/correlation.ts';

// 交叉/相关章节只在各自的数据对象或效应量开关变化时重渲染；其它选项开关不触发。
const MemoComparisonBody = memo(ComparisonBody, (a, b) => a.comparison === b.comparison && a.inReport === b.inReport && (a.pro?.effectSize ?? false) === (b.pro?.effectSize ?? false));
const MemoCorrBody = memo(CorrBody);

interface QuestionSectionsProps {
  dataset: Dataset;
  stats: Record<string, Stat>;
  reliabilities: Record<string, Reliability | null>;
  extras: Record<string, ReliabilityExtras | null>;
  aiResults: Record<string, AIResult>;
  apaTables: boolean;
}

// 逐题分析是报告里最重的一块：选项开关只要不影响题目数字或数值格式，就整块跳过重渲染。
const QuestionSections = memo(function QuestionSections({ dataset, stats, reliabilities, extras, aiResults, apaTables }: QuestionSectionsProps) {
  return (
    <>
      {includedItems(dataset).map((item, i) =>
        item.kind === 'group' ? (
          <section className="q-sec" key={item.group.id}>
            <h3>
              <span className="qno">{i + 1}</span>
              {item.group.title}
              <span className="tag">题组</span>
            </h3>
            <p className="stat-line">题组共 {item.questions.length} 个子项，分别统计如下。</p>
            <GroupBody questions={item.questions} stats={stats} reliability={reliabilities[item.group.id] ?? null} extras={extras[item.group.id] ?? null} />
          </section>
        ) : (
          (() => {
            const q = item.question;
            const stat = stats[q.id];
            const ai = q.type === 'open' ? aiResults[q.id] : undefined;
            if (!stat) return null;
            return (
              <section className="q-sec" key={q.id}>
                <h3>
                  <span className="qno">{i + 1}</span>
                  {q.title}
                  <span className="tag">{q.derived ? '维度得分' : TYPE_LABELS[q.type]}</span>
                </h3>
                {q.derived && <p className="r-note">{scoreNote(q, dataset)}</p>}
                {stat.n === 0 ? (
                  <p className="empty">{q.derived ? '按当前的算分条件，没有任何问卷得到得分。' : '这道题没有有效回答。'}</p>
                ) : (
                  <>
                    <p className="stat-line">{apaTables ? apaLine(stat, !!q.derived) : sentence(stat, !!q.derived)}</p>
                    <QuestionBody stat={stat} bare />
                  </>
                )}
                {q.type === 'open' && stat.n > 0 &&
                  (ai ? (
                    <div className="r-ai">
                      <p className="ai-summary">{ai.summary}</p>
                      <ThemeList result={ai} />
                      <p className="ai-note">{aiNote(ai)}</p>
                    </div>
                  ) : (
                    <p className="ai-note">此题未做 AI 归纳，原始回答不放入报告。</p>
                  ))}
              </section>
            );
          })()
        ),
      )}
    </>
  );
});

interface ReportProps {
  correlation: Correlation | null;
  comparison: Comparison | null;
  dataset: Dataset;
  stats: Record<string, Stat>;
  reliabilities: Record<string, Reliability | null>;
  findings: string[];
  title: string;
  aiResults: Record<string, AIResult>;
  rows: Record<string, string>[];
  cleaning: CleaningSummary | null;
  pro: ProModeOptions;
  extras: Record<string, ReliabilityExtras | null>;
}

export function Report({ correlation, comparison, dataset, stats, findings, title, aiResults, reliabilities, rows, cleaning, pro, extras }: ReportProps) {
  const included = dataset.questions.filter((q) => q.included);
  // 专业模式下的口径说明；没启用任何项时为空。
  const proLines = [
    pro.correction
      ? `多重比较校正用 ${CORRECTION_LABELS[pro.correction]}${comparison?.adjust ? `（交叉分析 ${comparison.adjust.m} 处比较）` : ''}${correlation?.adjust ? `（相关分析 ${correlation.adjust.m} 对）` : ''}；校正只用于“是否算明确差别”的判定，表中 95% 区间未校正。`
      : '',
    pro.effectSize ? "效应量：Cramér's V（2×2 表即 φ），0.1、0.3、0.5 约对应小、中、大。" : '',
    pro.alphaCI ? "信度区间：Cronbach's α 的 95% Bootstrap 区间（固定种子、百分位法，可复现）。" : '',
    pro.distribution ? '分布描述：偏度与峰度按 type 2 公式（与 SPSS 默认一致），标准误分别为 √(6/n) 与 √(24/n)。' : '',
    pro.missingTable ? '缺失情况：逐题列出有效回答、缺失份数与缺失率；缺失率 = 缺失份数 ÷（有效回答 + 缺失份数）。' : '',
    pro.apaTables ? '表格为三线表，数值写作 M、SD 与 95% CI。' : '',
    pro.spearman ? '相关分析用 Spearman 秩相关；取值重复较多时 p 值为近似，区间为 Fisher z 近似。' : '',
    pro.rankTest ? '分组比较使用 Mann–Whitney U（各组相对基准组）与 Kruskal–Wallis（整体），效应量为 r 与 ε²；均值差与区间仍按 Welch 法列出。' : '',
    pro.scoreForms ? '维度得分的形式（均值、求和或 z 分）见各得分章节；z 分按计入分析的问卷标准化。' : '',
    pro.factorCheck ? '因子前置检验：KMO 与 Bartlett 球形检验；单因子 ω 以第一主成分载荷近似，依赖单因子假设。' : '',
  ].filter(Boolean);
  // “数据质量”一节：有分布形态的题（量表、数值、得分）。
  const shapes = included.flatMap((q) => {
    const s = stats[q.id];
    return s && (s.kind === 'scale' || s.kind === 'numeric') && s.shape ? [{ q, shape: s.shape }] : [];
  });
  const anyReversed = dataset.questions.some((q) => q.included && q.reversed);
  const anyReliability = Object.values(reliabilities).some((r) => r !== null && r !== undefined);
  const reversedNotes = dataset.groups.flatMap((g) => {
    const members = included.filter((q) => q.reversed && q.groupId === g.id);
    const range = reliabilities[g.id]?.range;
    if (members.length === 0 || !range) return [];
    const flip = range.min + range.max;
    return [`题组「${g.title}」的${members.map((q) => `「${q.subTitle ?? q.title}」`).join('')}按 ${Number.isInteger(flip) ? flip : flip.toFixed(2)} 减原始分翻转（取值范围 ${range.min}–${range.max}）`];
  });
  // 维度得分：报告里写明每个得分的口径和没有得分的份数。
  const scores = includedItems(dataset).flatMap((item) => {
    if (item.kind !== 'question' || !item.question.derived) return [];
    const stat = stats[item.question.id];
    return [{ note: scoreNote(item.question, dataset), missing: stat?.missing ?? 0 }];
  });
  const usedAI = included.filter((q) => q.type === 'open' && aiResults[q.id]);
  const models = [...new Set(usedAI.map((q) => aiResults[q.id].model))];
  const count = (t: string) => included.filter((q) => q.type === t && !q.derived).length;
  const scoreCount = included.filter((q) => q.derived).length;
  const kinds = (
    [
      ['单选', count('single')],
      ['多选', count('multi')],
      ['量表', count('scale')],
      ['数值', count('numeric')],
      ['开放题', count('open')],
    ] as [string, number][]
  )
    .filter(([, n]) => n !== 0)
    .map(([k, n]) => `${k} ${n} 道`);
  if (scoreCount > 0) kinds.push(`维度得分 ${scoreCount} 个`);

  return (
    <article className={`page${pro.apaTables ? ' apa' : ''}`}>
      <section className="cover">
        <p className="cover-label">
          问卷分析报告
          {pro.on && <span className="pro-badge">专业模式</span>}
        </p>
        <h1>{title || '未命名报告'}</h1>
        <dl className="cover-meta">
          <div>
            <dt>数据文件</dt>
            <dd>{dataset.fileName}</dd>
          </div>
          <div>
            <dt>样本</dt>
            <dd>
              {validRowCount(dataset, rows)} 份有效（共 {dataset.rows.length} 份{cleaning && cleaning.excluded > 0 ? `，剔除 ${cleaning.excluded} 份` : ''}）
            </dd>
          </div>
          <div>
            <dt>纳入题目</dt>
            <dd>
              {included.length} 道{scoreCount > 0 ? `（含 ${scoreCount} 个维度得分）` : ''}
            </dd>
          </div>
          <div>
            <dt>生成时间</dt>
            <dd>{formatDateTime(dataset.importedAt)}</dd>
          </div>
        </dl>
        <p className="cover-foot">由 Readout · 问卷读数 生成</p>
      </section>

      <section className="r-sec">
        <h2>摘要</h2>
        {cleaning && <p className="r-note">{cleaningSentence(cleaning)}</p>}
        {findings.length ? (
          <ol className="finding-list">
            {findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ol>
        ) : (
          <p className="empty">没有可汇总的题目。</p>
        )}
        <p className="r-note">
          本报告共纳入 {included.length} 道题（{kinds.join('、')}）。
        </p>
      </section>

      {pro.on && (pro.missingTable || pro.distribution) && (
        <section className="r-sec" id="r-quality">
          <h2>数据质量</h2>
          {pro.missingTable && (
            <>
              <h3>逐题缺失率</h3>
              <div className="table-scroll">
                <table className="dist">
                  <thead>
                    <tr>
                      <th>题目</th>
                      <th>有效回答</th>
                      <th>缺失</th>
                      <th>缺失率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {included
                      .filter((q) => !q.derived)
                      .map((q) => {
                        const s = stats[q.id];
                        if (!s) return null;
                        const total = s.n + s.missing;
                        return (
                          <tr key={q.id}>
                            <td>{q.subTitle ?? q.title}</td>
                            <td>{s.n}</td>
                            <td>{s.missing}</td>
                            <td>{total ? formatPct(s.missing / total) : '—'}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {pro.distribution && shapes.length > 0 && (
            <>
              <h3>分布形态</h3>
              <div className="table-scroll">
                <table className="dist">
                  <thead>
                    <tr>
                      <th>变量</th>
                      <th>n</th>
                      <th>偏度（SE）</th>
                      <th>峰度（SE）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shapes.map(({ q, shape }) => (
                      <tr key={q.id}>
                        <td>{q.subTitle ?? q.title}</td>
                        <td>{shape.n}</td>
                        <td>
                          {shape.skew.toFixed(2)}（{shape.skewSE.toFixed(2)}）
                        </td>
                        <td>
                          {shape.kurtosis.toFixed(2)}（{shape.kurtosisSE.toFixed(2)}）
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      <section className="r-sec">
        <h2>逐题分析</h2>
        <QuestionSections dataset={dataset} stats={stats} reliabilities={reliabilities} extras={extras} aiResults={aiResults} apaTables={pro.apaTables} />
      </section>

      {comparison && (
        <section className="r-sec">
          <h2>交叉分析</h2>
          <p className="cmp-caption">
            按「{comparison.groupTitle}」分组，比较各组的「{comparison.compareTitle}」：共 {comparison.n} 条记录同时有效回答了这两道题，分成 {comparison.groups.length} 组。
          </p>
          <MemoComparisonBody comparison={comparison} inReport pro={pro} />
        </section>
      )}

      {correlation && (
        <section className="r-sec">
          <h2>相关分析</h2>
          <MemoCorrBody corr={correlation} inReport />
        </section>
      )}

      <section className="r-sec methods">
        <h2>方法说明</h2>
        <dl>
          <dt>数据来源</dt>
          <dd>
            {dataset.fileName}
            {dataset.sheet ? `（工作表「${dataset.sheet}」）` : ''}，共 {dataset.rows.length} 行，{dataset.encoding} 编码
            {dataset.skippedRows > 0 ? `，表头上方有 ${dataset.skippedRows} 行非表头内容已跳过` : ''}。
          </dd>
          <dt>题型识别</dt>
          <dd>由 Readout 自动识别，并可在工作台手动调整；被忽略的题目不进入统计和报告。按选项序号导出的 1–10 整数编码判为单选题；表头形如「第N题(子项)」或「题干[子项]」的列自动组成题组。</dd>
          <dt>有效回答</dt>
          <dd>非空，且不等于 N/A、-、—、未填写 等占位值的单元格；缺失值不计入分母。</dd>
          <dt>单选</dt>
          <dd>占比 = 选择该选项的人数 ÷ 该题有效回答数。按选项序号导出的整数只代表选项，报告中原样显示编码，无法还原选项文字。</dd>
          <dt>多选</dt>
          <dd>按 ; ； | ┋ 拆分，同一人的重复选项去重；占比以人数为分母，合计可超过 100%。「其他〖补充文字〗」计入「其他」，补充文字单独列出。</dd>
          <dt>题组</dt>
          <dd>题组在报告中占一个章节，各子项分别统计；可以在工作台合并或拆分，忽略操作作用于整个题组。</dd>
          {anyReversed && (
            <>
              <dt>反向计分</dt>
              <dd>
                被标为反向的题：{reversedNotes.length > 0 ? reversedNotes.join('；') : '无'}。翻转后的分数只用于信度计算，各题的均值和分布仍按原始作答报告。
              </dd>
            </>
          )}
          {anyReliability && (
            <>
              <dt>信度</dt>
              <dd>
                Cronbach's α 只用在题组全部量表子题上都有作答的问卷上计算，未答全的问卷不参与；校正后项总相关是该题与其余各题之和的相关，删除该项后的 α 是去掉该题后其余题的 α。α 不设合格线。
              </dd>
            </>
          )}
          <dt>量表</dt>
          <dd>均值、中位数、样本标准差（n−1）、Top-2 占比（最高两个量表点的占比）。文本量表（如非常不符合…非常符合）按常见顺序赋 1–5 分计算均值和区间，档位名称保持原文。</dd>
          <dt>数值</dt>
          <dd>均值、中位数、最小值、最大值；直方图按整齐步长分箱。</dd>
          {scores.length > 0 && (
            <>
              <dt>维度得分</dt>
              <dd>
                维度得分是题组各量表子题的均值；反向题先按翻转范围（最小值 + 最大值 − 原始分）换算，再按数值题统计。
                {scores.map((s) => s.note).join('')}
              </dd>
            </>
          )}
          <dt>开放题</dt>
          <dd>统计有效回答数和平均字数。
            {usedAI.length > 0
              ? ` 主题由 ${models.join('、')} 归纳：超过 240 条时等距抽样，主题与条数为模型估算，仅供参考；引文均逐字来自原始回答。`
              : ' 本报告未使用 AI 归纳。'}
          </dd>
          <dt>占比的 95% 区间</dt>
          <dd>Wilson 区间，以该题的有效回答数为分母；多选题每个选项单独计算。</dd>
          <dt>均值与中位数的 95% 区间</dt>
          <dd>
            量表题的均值用 t 区间，Top-2 占比用 Wilson 区间；数值题的均值和中位数用 Bootstrap（2000 次重抽样，百分位法；
            超过 5000 条时减为 500 次），随机种子固定，同一份数据每次得到相同的区间。有效回答不足 2 条时不给区间。
          </dd>
          <dt>小样本提示</dt>
          <dd>有效回答少于 30 条提示「区间较宽」，少于 10 条提示「仅供参考」。</dd>
          {comparison && (
            <>
              <dt>交叉分析：分组与差值</dt>
              <dd>
                按一道单选题分组，基准组是人数最多的一组（人数相同按拼音序）。占比差 = 该组占比 − 基准组占比，区间用
                Newcombe 法；均值差 = 该组均值 − 基准组均值，区间和 p 值用 Welch 法（不假设两组方差相等），效应量为
                Cohen's d。结论里的「有差别」指差值的 95% 区间不含 0。
              </dd>
              <dt>交叉分析：分布检验</dt>
              <dd>
                单选题做整表的独立性检验，多选题每个选项分别做「选/未选」检验。默认 Pearson 卡方（不做连续性校正）；
                恰好两组且有格子期望频数小于 5 时改用 Fisher 精确检验；三组及以上且超过 20% 的格子期望频数小于 5
                时，结果旁标注不可靠。多选题各选项分别检验，未做多重比较校正，p 值偏乐观。
              </dd>
            </>
          )}
          {correlation && (
            <>
              <dt>相关分析</dt>
              <dd>
                Pearson 相关系数；95% 区间用 Fisher z 变换，p 值用 t 分布（自由度 n − 2），与 R 的 cor.test 一致。
                每一对只用两者都有作答的问卷（成对删除），样本量写在结果里。{correlation.variables.length} 个变量两两检验，
                共 {correlation.pairs.length} 对，未做多重比较校正。结论里的「区间不含 0」不是「显著」。
              </dd>
            </>
          )}
          {cleaning && (
            <>
              <dt>数据清洗</dt>
              <dd>
                {cleaning.rules.map((r) => `${r.label}，${r.rule.mode === 'exclude' ? '命中即剔除' : '命中仅标记'}`).join('；')}
                {cleaning.rules.length > 0 && cleaning.dropped > 0 ? '；' : ''}
                {cleaning.dropped > 0 ? `手动剔除 ${cleaning.dropped} 份` : ''}
                {cleaning.flagged > 0 ? `。被标记的问卷${cleaning.includeFlagged ? '已' : '未'}计入分析` : ''}
                {cleaning.kept > 0 ? `。另有 ${cleaning.kept} 份命中剔除规则但手动保留` : ''}
                。
              </dd>
            </>
          )}
          {pro.on && proLines.length > 0 && (
            <>
              <dt>专业模式</dt>
              <dd>{proLines.join(' ')}</dd>
            </>
          )}
          <dt>统计边界</dt>
          <dd>未做加权。区间和 p 值只反映随机抽样带来的误差，不能修正样本本身的偏差（如自愿填写、覆盖不全）。</dd>
        </dl>
      </section>
    </article>
  );
}

// 论文数值格式：M = 3.16，SD = 0.87，95% CI [3.02, 3.34]，n = 128。
function apaLine(stat: Stat, derived: boolean): string {
  if ((stat.kind === 'scale' || stat.kind === 'numeric') && stat.mean !== null) {
    const sd = stat.sd === null ? '' : `，SD = ${stat.sd.toFixed(2)}`;
    const ci = stat.meanCI ? `，95% CI [${stat.meanCI.lower.toFixed(2)}, ${stat.meanCI.upper.toFixed(2)}]` : '';
    const miss = stat.missing > 0 ? `（另有 ${stat.missing} 份没有${derived ? '得分' : '作答'}）` : '';
    return `${derived ? '有效得分：' : ''}M = ${stat.mean.toFixed(2)}${sd}${ci}，n = ${stat.n}${miss}。`;
  }
  return sentence(stat, derived);
}
