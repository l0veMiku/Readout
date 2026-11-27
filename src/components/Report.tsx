import type { AIResult, Dataset } from '../types.ts';
import { TYPE_LABELS } from '../types.ts';
import type { Stat } from '../lib/stats.ts';
import { validRowCount } from '../lib/stats.ts';
import { includedItems } from '../lib/groups.ts';
import { formatDateTime } from '../lib/text.ts';
import { GroupBody, QuestionBody, ThemeList, aiNote, sentence } from './QuestionView.tsx';
import { ComparisonBody } from './Compare.tsx';
import type { Comparison } from '../lib/compare.ts';
import type { Reliability } from '../lib/reliability.ts';

interface ReportProps {
  comparison: Comparison | null;
  dataset: Dataset;
  stats: Record<string, Stat>;
  reliabilities: Record<string, Reliability | null>;
  findings: string[];
  title: string;
  aiResults: Record<string, AIResult>;
}

export function Report({ comparison, dataset, stats, findings, title, aiResults, reliabilities }: ReportProps) {
  const included = dataset.questions.filter((q) => q.included);
  const anyReversed = dataset.questions.some((q) => q.included && q.reversed);
  const anyReliability = Object.values(reliabilities).some((r) => r !== null && r !== undefined);
  const reversedNotes = dataset.groups.flatMap((g) => {
    const members = included.filter((q) => q.reversed && q.groupId === g.id);
    const range = reliabilities[g.id]?.range;
    if (members.length === 0 || !range) return [];
    const flip = range.min + range.max;
    return [`题组「${g.title}」的${members.map((q) => `「${q.subTitle ?? q.title}」`).join('')}按 ${Number.isInteger(flip) ? flip : flip.toFixed(2)} 减原始分翻转（取值范围 ${range.min}–${range.max}）`];
  });
  const usedAI = included.filter((q) => q.type === 'open' && aiResults[q.id]);
  const models = [...new Set(usedAI.map((q) => aiResults[q.id].model))];
  const count = (t: string) => included.filter((q) => q.type === t).length;
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

  return (
    <article className="page">
      <section className="cover">
        <p className="cover-label">问卷分析报告</p>
        <h1>{title || '未命名报告'}</h1>
        <dl className="cover-meta">
          <div>
            <dt>数据文件</dt>
            <dd>{dataset.fileName}</dd>
          </div>
          <div>
            <dt>样本</dt>
            <dd>
              {validRowCount(dataset)} 份有效（共 {dataset.rows.length} 份）
            </dd>
          </div>
          <div>
            <dt>纳入题目</dt>
            <dd>{included.length} 道</dd>
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

      <section className="r-sec">
        <h2>逐题分析</h2>
        {includedItems(dataset).map((item, i) =>
          item.kind === 'group' ? (
            <section className="q-sec" key={item.group.id}>
              <h3>
                <span className="qno">{i + 1}</span>
                {item.group.title}
                <span className="tag">题组</span>
              </h3>
              <p className="stat-line">题组共 {item.questions.length} 个子项，分别统计如下。</p>
              <GroupBody questions={item.questions} stats={stats} reliability={reliabilities[item.group.id] ?? null} />
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
                    <span className="tag">{TYPE_LABELS[q.type]}</span>
                  </h3>
                  {stat.n === 0 ? (
                    <p className="empty">这道题没有有效回答。</p>
                  ) : (
                    <>
                      <p className="stat-line">{sentence(stat)}</p>
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
      </section>

      {comparison && (
        <section className="r-sec">
          <h2>交叉分析</h2>
          <p className="cmp-caption">
            按「{comparison.groupTitle}」分组，比较各组的「{comparison.compareTitle}」：共 {comparison.n} 条记录同时有效回答了这两道题，分成 {comparison.groups.length} 组。
          </p>
          <ComparisonBody comparison={comparison} inReport />
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
          <dt>统计边界</dt>
          <dd>未做加权。区间和 p 值只反映随机抽样带来的误差，不能修正样本本身的偏差（如自愿填写、覆盖不全）。</dd>
        </dl>
      </section>
    </article>
  );
}
