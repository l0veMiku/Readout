import css from '../styles.css?inline';
import { buildReportHtml as buildDocument } from './reportFile.ts';

// 单独一层：把整份样式表内联进导出文件，纯函数放在 reportFile.ts，便于单元测试。
export const buildReportHtml = (body: string, title: string) => buildDocument(body, title, css);
