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
}

export interface QuestionGroup {
  id: string;
  title: string;
  questionIds: string[];
}

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
}

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
