import { useMemo, useState } from 'react';
import type { Cleaning, CleaningRule, Dataset, RuleType } from '../types.ts';
import { RULE_LABELS, RULE_TYPES, durationInfo, evaluateCleaning, hasCleaning, newRule, ruleLabel, ruleReady, rowLabels } from '../lib/cleaning.ts';
import { reliability } from '../lib/reliability.ts';
import { computeStat } from '../lib/stats.ts';

interface CleaningPanelProps {
  dataset: Dataset;
  onClose: () => void;
  // 点「应用」才把草稿交出去；没有生效的规则时交出去的是 undefined。
  onApply: (cleaning: Cleaning | undefined) => void;
}

const EMPTY: Cleaning = { rules: [], includeFlagged: true, overrides: {}, zeroMissing: false };

export function CleaningPanel({ dataset, onClose, onApply }: CleaningPanelProps) {
  const [draft, setDraft] = useState<Cleaning>(() => dataset.cleaning ?? EMPTY);
  const [copied, setCopied] = useState<'excluded' | 'flagged' | null>(null);
  const duration = useMemo(() => durationInfo(dataset), [dataset]);
  const labels = useMemo(() => rowLabels(dataset), [dataset]);
  // 预览按草稿算，不碰当前数据集。
  const preview = useMemo(() => evaluateCleaning({ ...dataset, cleaning: draft }), [dataset, draft]);

  const patch = (next: Partial<Cleaning>) => setDraft((d) => ({ ...d, ...next }));
  const updateRule = (id: string, next: Partial<CleaningRule>) =>
    setDraft((d) => ({ ...d, rules: d.rules.map((r) => (r.id === id ? ({ ...r, ...next } as CleaningRule) : r)) }));

  const included = dataset.questions.filter((q) => q.included);
  const scaleGroups = dataset.groups.filter((g) => included.filter((q) => q.groupId === g.id && q.type === 'scale').length >= 2);
  const contradictionGroups = scaleGroups.filter((g) => {
    const members = included.filter((q) => q.groupId === g.id && q.type === 'scale');
    return members.some((q) => q.reversed) && members.some((q) => !q.reversed);
  });
  const screenQuestions = included.filter((q) => q.type === 'single' || q.type === 'multi');
  const unavailable: Partial<Record<RuleType, string>> = {
    duration: duration ? '' : '文件里没有作答时长列',
    straightline: scaleGroups.length > 0 ? '' : '没有含两道以上量表子题的题组',
    screening: screenQuestions.length > 0 ? '' : '没有单选或多选题',
    contradiction: contradictionGroups.length > 0 ? '' : '需要先在题组卡片里标出反向题',
  };

  const excluded = preview.status.flatMap((s, i) => (s === 'excluded' ? [i] : []));
  const flagged = preview.status.flatMap((s, i) => (s === 'flagged' ? [i] : []));
  const anyFlagRule = draft.rules.some((r) => ruleReady(r) && r.mode === 'flag');
  const analyzed = dataset.rows.length - excluded.length - (draft.includeFlagged ? 0 : flagged.length);

  const copy = async (which: 'excluded' | 'flagged') => {
    const text = (which === 'excluded' ? excluded : flagged).map((ri) => labels.labels[ri]).join(', ');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setCopied(null);
    }
  };

  const inputs = (rule: CleaningRule) => {
    switch (rule.type) {
      case 'duration':
        return (
          <span>
            作答时长低于
            <input type="number" min={1} aria-label="低于多少秒" value={rule.maxSeconds || ''} onChange={(e) => updateRule(rule.id, { maxSeconds: e.target.valueAsNumber })} />
            秒
          </span>
        );
      case 'straightline':
        return (
          <select aria-label="题组" value={rule.groupId} onChange={(e) => updateRule(rule.id, { groupId: e.target.value })}>
            <option value="">选择题组</option>
            {scaleGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        );
      case 'screening': {
        const question = dataset.questions.find((q) => q.id === rule.questionId);
        const stat = question ? computeStat(question, dataset.rows) : null;
        const options = stat && (stat.kind === 'single' || stat.kind === 'multi') ? stat.options.map((o) => o.name) : [];
        return (
          <>
            <select aria-label="甄别题" value={rule.questionId} onChange={(e) => updateRule(rule.id, { questionId: e.target.value, option: '' })}>
              <option value="">选择题</option>
              {screenQuestions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title}
                </option>
              ))}
            </select>
            <select aria-label="选项" value={rule.option} onChange={(e) => updateRule(rule.id, { option: e.target.value })} disabled={!question}>
              <option value="">选择选项</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </>
        );
      }
      case 'completion':
        return (
          <span>
            完成率低于
            <input type="number" min={1} max={100} aria-label="低于百分之几" value={rule.minPercent || ''} onChange={(e) => updateRule(rule.id, { minPercent: e.target.valueAsNumber })} />
            %
          </span>
        );
      case 'contradiction':
        return (
          <>
            <select
              aria-label="题组"
              value={rule.groupId}
              onChange={(e) => {
                const groupId = e.target.value;
                const range = reliability(included.filter((q) => q.groupId === groupId), dataset.rows)?.range;
                // 差值阈值预填量表级数的一半（5 点量表是 2），用户可以改。
                updateRule(rule.id, { groupId, maxGap: rule.maxGap > 0 ? rule.maxGap : range ? (range.max - range.min) / 2 : 0 });
              }}
            >
              <option value="">选择题组</option>
              {contradictionGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
            <span>
              正反向均值差超过
              <input type="number" min={0} step={0.5} aria-label="差值超过多少" value={rule.maxGap || ''} onChange={(e) => updateRule(rule.id, { maxGap: e.target.valueAsNumber })} />
            </span>
          </>
        );
    }
  };

  const list = (which: 'excluded' | 'flagged') => {
    const rows = which === 'excluded' ? excluded : flagged;
    const name = which === 'excluded' ? '被剔除的问卷' : '被标记的问卷';
    const text = rows.map((ri) => labels.labels[ri]).join(', ');
    return (
      <details className="clean-details" open={rows.length > 0 && rows.length <= 50}>
        <summary>
          {name} · {rows.length} 份
        </summary>
        {rows.length > 0 && (
          <ul className="clean-list">
            {rows.map((ri) => (
              <li key={ri}>
                <b>{labels.labels[ri]}</b>
                <span className="why">{preview.hits[ri].map((r) => ruleLabel(r, dataset)).join('；') || '手动剔除'}</span>
                {which === 'excluded' ? (
                  <button type="button" className="link" onClick={() => patch({ overrides: { ...draft.overrides, [ri]: 'keep' } })}>
                    保留
                  </button>
                ) : (
                  <button type="button" className="link" onClick={() => patch({ overrides: { ...draft.overrides, [ri]: 'drop' } })}>
                    剔除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <div className="copy-row">
            <input className="copy-text" readOnly aria-label={`${name}的序号`} value={text} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn small" onClick={() => void copy(which)}>
              {copied === which ? '已复制' : '复制序号'}
            </button>
          </div>
        )}
      </details>
    );
  };

  const kept = Object.entries(draft.overrides).filter(([, v]) => v === 'keep').length;
  const dropped = Object.entries(draft.overrides).filter(([, v]) => v === 'drop').length;

  return (
    <div className="ai-form clean-form">
      <label className="inline">
        <input type="checkbox" checked={!!draft.zeroMissing} onChange={(e) => patch({ zeroMissing: e.target.checked })} />
        把 0 当作缺失（所有题）
      </label>
      {duration && (
        <p className="hint">
          时长列「{duration.title}」按秒处理
          {duration.median !== null && `，中位数 ${Math.round(duration.median)} 秒`}
          {duration.unreadable > 0 && `，有 ${duration.unreadable} 份读不出时长`}
          。
        </p>
      )}
      {duration?.warning && <p className="alert">{duration.warning}</p>}
      <p className="clean-summary">
        回收 {dataset.rows.length} 份 · 剔除 {excluded.length} 份 · 标记 {flagged.length} 份 · 计入分析 {analyzed} 份
      </p>

      {draft.rules.map((rule) => (
        <div className="rule-card" data-rule-type={rule.type} key={rule.id}>
          <div className="rule-head">
            <b>{RULE_LABELS[rule.type]}</b>
            <button type="button" className="link" onClick={() => patch({ rules: draft.rules.filter((r) => r.id !== rule.id) })}>
              删除
            </button>
          </div>
          <div className="rule-inputs">{inputs(rule)}</div>
          <div className="rule-foot">
            <label className="inline">
              <input type="radio" name={`mode-${rule.id}`} checked={rule.mode === 'flag'} onChange={() => updateRule(rule.id, { mode: 'flag' })} />
              仅标记
            </label>
            <label className="inline">
              <input type="radio" name={`mode-${rule.id}`} checked={rule.mode === 'exclude'} onChange={() => updateRule(rule.id, { mode: 'exclude' })} />
              剔除
            </label>
            <span className="rule-count">{ruleReady(rule) ? `命中 ${preview.counts[rule.id] ?? 0} 份` : '填好参数后显示命中份数'}</span>
          </div>
          {rule.type === 'completion' && (
            <p className="hint">
              分母是纳入分析的 {included.length} 道题。问卷有跳题逻辑时，没答的题可能是按要求跳过的，这条规则会误伤，建议只用「仅标记」。
            </p>
          )}
        </div>
      ))}

      <p className="field">
        <select
          aria-label="添加规则"
          value=""
          onChange={(e) => {
            const type = e.target.value as RuleType;
            if (RULE_TYPES.includes(type)) patch({ rules: [...draft.rules, newRule(type)] });
          }}
        >
          <option value="">添加规则…</option>
          {RULE_TYPES.map((type) => (
            <option key={type} value={type} disabled={!!unavailable[type]}>
              {RULE_LABELS[type]}
              {unavailable[type] ? `（${unavailable[type]}）` : ''}
            </option>
          ))}
        </select>
      </p>

      {anyFlagRule && (
        <>
          <label className="inline">
            <input type="checkbox" checked={draft.includeFlagged} onChange={(e) => patch({ includeFlagged: e.target.checked })} />
            分析时包含仅标记的问卷
          </label>
        </>
      )}

      {list('excluded')}
      {list('flagged')}
      {kept + dropped > 0 && (
        <p className="hint">
          手动例外：保留 {kept} 份，剔除 {dropped} 份。{' '}
          <button type="button" className="link" onClick={() => patch({ overrides: {} })}>
            全部撤销
          </button>
        </p>
      )}

      <footer className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            const rules = draft.rules.filter(ruleReady);
            const cleaning: Cleaning = { ...draft, rules };
            onApply(hasCleaning(cleaning) ? cleaning : undefined);
            onClose();
          }}
        >
          应用
        </button>
      </footer>
    </div>
  );
}
