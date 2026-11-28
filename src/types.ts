export type QuestionType = 'single' | 'multi' | 'scale' | 'numeric' | 'open' | 'meta';

export const QUESTION_TYPES: QuestionType[] = ['single', 'multi', 'scale', 'numeric', 'open', 'meta'];

export const TYPE_LABELS: Record<QuestionType, string> = {
  single: '单选',
  multi: '多选',
  scale: '量表',
  numeric: '数值',
  open: '开放题',
  meta: '元数据',
};

export interface Question {
  id: string;
  title: string;
  rawTitle: string;
  type: QuestionType;
  included: boolean;
  groupId?: string;
  subTitle?: string;
  // 反向计分题：只影响题组的信度计算，各题自己的统计照旧按原始作答。
  reversed?: boolean;
  // 派生题目：由题组的子项算出来，不对应文件里的列。
  derived?: { kind: 'score'; groupId: string };
}

export interface QuestionGroup {
  id: string;
  title: string;
  questionIds: string[];
}

export type RuleType = 'duration' | 'straightline' | 'screening' | 'completion' | 'contradiction';

// exclude：命中即剔除；flag：只标记，是否计入分析由 Cleaning.includeFlagged 决定。
export type RuleMode = 'exclude' | 'flag';

export type CleaningRule =
  | { id: string; type: 'duration'; maxSeconds: number; mode: RuleMode }
  | { id: string; type: 'straightline'; groupId: string; mode: RuleMode }
  | { id: string; type: 'screening'; questionId: string; option: string; mode: RuleMode }
  | { id: string; type: 'completion'; minPercent: number; mode: RuleMode }
  | { id: string; type: 'contradiction'; groupId: string; maxGap: number; mode: RuleMode };

export interface Cleaning {
  rules: CleaningRule[];
  includeFlagged: boolean;
  // 单份例外，键是数据行号：keep 留下被规则剔除的问卷，drop 手动剔除。
  overrides: Record<number, 'keep' | 'drop'>;
}

// 维度得分的缺失规则：complete 要求全部子项有作答；partial80 要求至少 80% 的子项有作答。
export type ScoreMissing = 'complete' | 'partial80';
// 维度得分的形式：均值（默认）、求和、z 分。
export type ScoreForm = 'mean' | 'sum' | 'z';

export interface Dataset {
  fileName: string;
  importedAt: string;
  encoding: string;
  sheet?: string;
  skippedRows: number;
  headers: string[];
  rows: Record<string, string>[];
  questions: Question[];
  groups: QuestionGroup[];
  // 没有清洗设置时不存在，所有问卷都计入分析。
  cleaning?: Cleaning;
  // 哪些题组生成了维度得分，以及各自的缺失规则；没有生成时不存在。
  scores?: Record<string, ScoreMissing>;
  // 各题组得分的形式；缺省即均值。
  scoreForms?: Record<string, ScoreForm>;
}

// 专业模式：报告页的开关，默认全关，所有分析回到默认口径；状态只在内存里。
export type CorrectionMethod = 'holm' | 'bh';

export interface ProModeOptions {
  on: boolean;
  // 多重比较校正：null 表示不校正。
  correction: CorrectionMethod | null;
  effectSize: boolean;
  alphaCI: boolean;
  distribution: boolean;
  missingTable: boolean;
  apaTables: boolean;
  spearman: boolean;
  rankTest: boolean;
  scoreForms: boolean;
  factorCheck: boolean;
}

export const PRO_MODE_OFF: ProModeOptions = {
  on: false,
  correction: null,
  effectSize: false,
  alphaCI: false,
  distribution: false,
  missingTable: false,
  apaTables: false,
  spearman: false,
  rankTest: false,
  scoreForms: false,
  factorCheck: false,
};

// 打开专业模式时的默认状态：A 档整套启用，B 档逐项自选。
export const PRO_MODE_ON: ProModeOptions = {
  ...PRO_MODE_OFF,
  on: true,
  correction: 'holm',
  effectSize: true,
  alphaCI: true,
  distribution: true,
  missingTable: true,
  apaTables: true,
};

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'mixed';

export interface Theme {
  name: string;
  description: string;
  sentiment: Sentiment;
  count: number;
  quotes: string[];
}

export interface AIResult {
  summary: string;
  themes: Theme[];
  total: number;
  analyzed: number;
  sampled: boolean;
  model: string;
  createdAt: string;
}

export interface AIConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}
