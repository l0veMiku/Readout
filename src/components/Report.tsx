import type { AIResult, Dataset } from '../types.ts';
import { TYPE_LABELS } from '../types.ts';
import type { Stat } from '../lib/stats.ts';
import { validRowCount } from '../lib/stats.ts';
import { formatDateTime } from '../lib/text.ts';
import { QuestionBody, ThemeList, aiNote, sentence } from './QuestionView.tsx';
import { ComparisonBody } from './Compare.tsx';
import type { Comparison } from '../lib/compare.ts';

interface ReportProps {
  comparison: Comparison | null;
  dataset: Dataset;
  stats: Record<string, Stat>;
  findings: string[];
  title: string;
  aiResults: Record<string, AIResult>;
}

export function Report({ comparison, dataset, stats, findings, title, aiResults }: ReportProps) {
  const included = dataset.questions.filter((q) => q.included);
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
        {included.map((q, i) => {
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
                  <div className="r-ai">
                    <div className="samples">
                      {stat.kind === 'open' && stat.samples.map((s, j) => <p key={j}>“{s}”</p>)}
                    </div>
                    <p className="ai-note">此题未做 AI 归纳，以上为等距抽取的原始回答。</p>
                  </div>
                ))}
            </section>
          );
        })}
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
            {dataset.fileName}，共 {dataset.rows.length} 行，{dataset.encoding} 编码
            {dataset.skippedRows > 0 ? `，表头上方有 ${dataset.skippedRows} 行非表头内容已跳过` : ''}。
          </dd>
          <dt>题型识别</dt>
          <dd>由 Readout 自动识别，并可在工作台手动调整；被忽略的题目不进入统计和报告。</dd>
          <dt>有效回答</dt>
          <dd>非空，且不等于 N/A、-、—、未填写 等占位值的单元格；缺失值不计入分母。</dd>
          <dt>单选</dt>
          <dd>占比 = 选择该选项的人数 ÷ 该题有效回答数。</dd>
          <dt>多选</dt>
          <dd>按 ; ； | ┋ 拆分，同一人的重复选项去重；占比以人数为分母，合计可超过 100%。</dd>
          <dt>量表</dt>
          <dd>均值、中位数、样本标准差（n−1）、Top-2 占比（最高两个量表点的占比）。</dd>
          <dt>数值</dt>
          <dd>均值、中位数、最小值、最大值；直方图按整齐步长分箱。</dd>
          <dt>开放题</dt>
          <dd>统计有效回答数和平均字数。
            {usedAI.length > 0
              ? ` 主题由 ${models.join('、')} 归纳：超过 240 条时等距抽样，主题与条数为模型估算，仅供参考；引文均逐字来自原始回答。`
              : ' 本报告未使用 AI 归纳。'}
          </dd>
          <dt>统计边界</dt>
          <dd>未做加权、显著性检验和置信区间，结果仅描述当前样本，不外推到总体。</dd>
        </dl>
      </section>
    </article>
  );
}
