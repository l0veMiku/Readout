// 列联表的效应量。卡方检验只回答有没有关联，Cramér's V 回答关联有多强，取值 0 到 1。
// 未经偏校正的 Cramér's V = sqrt(χ² / (n · min(r−1, c−1)))，χ² 是不做连续性校正的 Pearson 卡方；
// 行或列不足两个、或者表里一个观测都没有时没有定义，返回 null。
export function cramersV(table: number[][]): number | null {
  const rows = table.length;
  const cols = table[0]?.length ?? 0;
  const rowTotals = table.map((row) => row.reduce((s, x) => s + x, 0));
  const colTotals = Array.from({ length: cols }, (_, j) => table.reduce((s, row) => s + row[j], 0));
  const n = rowTotals.reduce((s, x) => s + x, 0);
  if (rows < 2 || cols < 2 || !(n > 0)) return null;
  let chi2 = 0;
  table.forEach((row, i) =>
    row.forEach((observed, j) => {
      // 期望频数 = 行合计 × 列合计 / n。整行或整列都没人时期望为 0，观测也必为 0，这种格子对卡方没有贡献。
      const expected = (rowTotals[i] * colTotals[j]) / n;
      if (expected > 0) chi2 += ((observed - expected) ** 2) / expected;
    }),
  );
  return Math.sqrt(chi2 / (n * Math.min(rows - 1, cols - 1)));
}
