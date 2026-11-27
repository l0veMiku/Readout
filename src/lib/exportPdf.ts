import { reportFileName } from './reportFile.ts';

export interface PdfExportOptions {
  element: HTMLElement;
  title: string;
  scale?: number;
  onProgress?: (done: number, total: number) => void;
  shouldCancel?: () => boolean;
}

// A4 版心：210×297mm，四周 15mm，按 96dpi 换成像素。
const MM_PER_INCH = 25.4;
const PX_PER_MM = 96 / MM_PER_INCH;
const PAGE_W = Math.round(180 * PX_PER_MM); // 680
const PAGE_H = Math.round(267 * PX_PER_MM); // 1009

const waitForFonts = async () => {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.ready) await fonts.ready;
};

type Capture = (node: HTMLElement, opts: { width: number; height: number }) => Promise<HTMLCanvasElement>;

// 把报告分页：先按顶层块排，顶层块（如「逐题分析」整节）放不下就拆成它的子块（逐题），
// 这样不会把一道题切成两页；只有单个块本身高于一页时才在块内切片。
async function renderPages(
  element: HTMLElement,
  scale: number,
  capture: Capture,
  onPage: (canvas: HTMLCanvasElement) => Promise<void>,
  shouldCancel?: () => boolean,
) {
  const host = document.createElement('div');
  host.className = 'pdf-host';
  host.style.cssText = 'position:fixed;left:-20000px;top:0;z-index:-1;background:#fff;';
  document.body.appendChild(host);

  const makePage = () => {
    const page = document.createElement('div');
    page.className = 'page pdf-page';
    page.style.cssText = `width:${PAGE_W}px;height:${PAGE_H}px;max-width:none;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;background:#fff;overflow:hidden;`;
    host.appendChild(page);
    return page;
  };

  // 用同宽的探针量高度：overflow:hidden 避免外边距穿过容器。
  const measure = (node: HTMLElement) => {
    const probe = document.createElement('div');
    probe.style.cssText = `width:${PAGE_W}px;background:#fff;overflow:hidden;position:absolute;left:0;top:0;visibility:hidden;`;
    probe.appendChild(node.cloneNode(true));
    host.appendChild(probe);
    const height = probe.scrollHeight;
    probe.remove();
    return height;
  };

  const queue = Array.from(element.children) as HTMLElement[];
  let page = makePage();
  let remaining = PAGE_H;
  let count = 0;

  try {
    while (queue.length > 0) {
      if (shouldCancel?.()) return count;
      const node = queue.shift() as HTMLElement;
      const height = measure(node);

      if (height > PAGE_H && node.children.length > 1) {
        // 整节放不下一页：改为逐块排（逐题 / 摘要条目 / 方法说明各行）。
        queue.unshift(...(Array.from(node.children) as HTMLElement[]));
        continue;
      }

      if (height <= remaining) {
        page.appendChild(node.cloneNode(true));
        remaining -= height;
        continue;
      }

      if (page.children.length > 0) {
        await onPage(await capture(page, { width: PAGE_W, height: PAGE_H }));
        count++;
        page.remove();
        page = makePage();
        remaining = PAGE_H;
      }

      if (height <= PAGE_H) {
        page.appendChild(node.cloneNode(true));
        remaining -= height;
        continue;
      }

      // 单个块高于一页：整块渲染后按页高切片（唯一会切开内容的情形）。
      const probe = document.createElement('div');
      probe.style.cssText = `width:${PAGE_W}px;background:#fff;`;
      probe.appendChild(node.cloneNode(true));
      host.appendChild(probe);
      const tallH = probe.scrollHeight;
      const tall = await capture(probe, { width: PAGE_W, height: tallH });
      probe.remove();
      const sliceH = PAGE_H * scale;
      for (let y = 0; y < tall.height; y += sliceH) {
        if (shouldCancel?.()) return count;
        const slice = document.createElement('canvas');
        slice.width = tall.width;
        slice.height = Math.min(sliceH, tall.height - y);
        slice.getContext('2d')?.drawImage(tall, 0, -y);
        await onPage(slice);
        count++;
        slice.width = 0;
        slice.height = 0;
      }
      tall.width = 0;
      tall.height = 0;
    }

    if (page.children.length > 0) {
      await onPage(await capture(page, { width: PAGE_W, height: PAGE_H }));
      count++;
    }
  } finally {
    page.remove();
    host.remove();
  }
  return count;
}

export async function exportReportPdf({ element, title, scale = 2, onProgress, shouldCancel }: PdfExportOptions): Promise<'saved' | 'cancelled'> {
  await waitForFonts();
  // PDF 工具链只在点「下载 PDF」时用得到，静态引入会让首屏多背数百 KB；
  // 这里按需加载是构建体积上的取舍，模块路径本身是固定的。
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  const capture: Capture = (node, { width, height }) =>
    html2canvas(node, {
      width,
      height,
      scale,
      backgroundColor: '#fff',
      logging: false,
      useCORS: false,
      // 用桌面宽度渲染克隆文档，避免截图时触发窄屏媒体查询；高度要覆盖整块，否则 html2canvas 会把内容截掉。
      windowWidth: 1280,
      windowHeight: Math.max(1000, height),
    });

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  let pages = 0;
  const perBlock = Array.from(element.children).reduce((sum, child) => sum + (child as HTMLElement).offsetHeight, 0);
  const estimate = Math.max(1, Math.ceil(perBlock / PAGE_H));

  await renderPages(
    element,
    scale,
    capture,
    async (canvas) => {
      const data = canvas.toDataURL('image/jpeg', 0.92);
      if (pages > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(data, 'JPEG', 15, 15, 180, 267, undefined, 'FAST');
      canvas.width = 0;
      canvas.height = 0;
      pages++;
      onProgress?.(pages, Math.max(estimate, pages));
    },
    shouldCancel,
  );

  if (shouldCancel?.() || pages === 0) return 'cancelled';
  pdf.save(reportFileName(title, 'pdf'));
  return 'saved';
}
