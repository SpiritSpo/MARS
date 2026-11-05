// Read-only financial reconciliation. No source amounts are changed.
const money = value => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Invalid monetary value');
  return Math.round(value * 100);
};
const rub = cents => cents / 100;

/**
 * Build a per-machine, per-month report from already validated monthly records.
 * FORMAT workbooks are comparison sources, never additional revenue.
 * Records with unverified figures remain visible with warnings.
 */
export function reconcileFinance(records) {
  if (!Array.isArray(records)) throw new TypeError('Records must be an array');
  const seen = new Set();
  return records.map(record => {
    if (!record || typeof record !== 'object') throw new TypeError('Invalid record');
    const {machineId, month, sourceType, revenue, expenses, reportedProfit} = record;
    if (typeof machineId !== 'string' || !machineId.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new TypeError('Invalid machine/month');
    if (sourceType !== 'monthly' && sourceType !== 'format') throw new TypeError('Invalid source type');
    const key = machineId + '|' + month + '|' + sourceType;
    if (seen.has(key)) throw new Error('Duplicate source: ' + key);
    seen.add(key);
    const computedCents = money(revenue) - money(expenses);
    const differenceCents = money(reportedProfit) - computedCents;
    return {
      machineId, month, sourceType,
      revenue, expenses, reportedProfit,
      calculatedProfit: rub(computedCents),
      discrepancy: rub(differenceCents),
      warnings: differenceCents ? [{code:'PROFIT_MISMATCH',amount:rub(differenceCents),message:'Бухгалтерская прибыль не совпадает с выручкой минус расходы'}] : [],
      includedInTotals: sourceType === 'monthly'
    };
  });
}
export function financeTotals(rows) {
  const monthly = rows.filter(row => row.includedInTotals);
  return {
    revenue: rub(monthly.reduce((sum,row) => sum + money(row.revenue),0)),
    expenses: rub(monthly.reduce((sum,row) => sum + money(row.expenses),0)),
    reportedProfit: rub(monthly.reduce((sum,row) => sum + money(row.reportedProfit),0)),
    discrepancyCount: monthly.filter(row => row.warnings.length).length
  };
}
