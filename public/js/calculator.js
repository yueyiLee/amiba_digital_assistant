/**
 * calculator.js — 阿米巴指标计算引擎（PRD 第 6 章 15 项指标）
 * 所有计算基于当月（自然月 1 日至月末）数据。
 */
const Calculator = (() => {

  function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function currentMonthRange() {
    const d = new Date();
    const y = d.getFullYear(), m = d.getMonth();
    const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const end = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end, month: `${y}-${String(m + 1).padStart(2, '0')}` };
  }

  function sumByType(transactions, type) {
    return transactions.filter(t => t.type === type).reduce((s, t) => s + Math.abs(t.amount), 0);
  }

  /**
   * 计算全部 15 项指标
   * @param {string} unitFilter 单元筛选（'全部单元' 或具体单元名）
   */
  function calculateMetrics(unitFilter) {
    const { start, end, month } = currentMonthRange();
    const txs = Storage.getTransactionsSync({ unit: unitFilter, startDate: start, endDate: end });
    const employees = Storage.getEmployeesSync();
    const workHours = Storage.getWorkHoursSync(month);

    // ---- 基础层 ----
    const salesIncome = txs.filter(t => t.type === '销售收入').reduce((s, t) => s + t.amount, 0);   // 1
    const cashIncome = txs.filter(t => t.type === '现金收入').reduce((s, t) => s + t.amount, 0);    // 2
    const totalIncome = salesIncome + cashIncome;                                                     // 3

    const materialCost = sumByType(txs, '材料采购');      // 4
    const processCost = sumByType(txs, '委托加工');       // 5
    const consumeCost = materialCost + processCost;        // 6
    const miscCost = sumByType(txs, '杂费支出');           // 7

    // ---- 阿米巴核心层 ----
    const addedValue = totalIncome - consumeCost - miscCost;  // 8 附加价值（核心）

    // 总工资 = Σ(工时 × 时薪)
    let totalSalary = 0;                                       // 9
    workHours.forEach(wh => {
      const emp = employees.find(e => e.id === wh.employee_id);
      if (emp) totalSalary += wh.hours * emp.hourly_rate;
    });

    const taxCost = sumByType(txs, '税金');                   // 10
    const profit = addedValue - totalSalary - taxCost;        // 11 利润

    // ---- 衍生效率层 ----
    const totalHours = workHours.reduce((s, w) => s + w.hours, 0);  // 12
    const unitAddedValue = totalHours > 0 ? addedValue / totalHours : 0;    // 13 单位时间附加值
    const unitSalary = totalHours > 0 ? totalSalary / totalHours : 0;       // 14 单位时间工资
    const unitProfit = totalHours > 0 ? profit / totalHours : 0;            // 15 单位时间利润

    return {
      salesIncome, cashIncome, totalIncome,
      materialCost, processCost, consumeCost, miscCost,
      addedValue, totalSalary, taxCost, profit,
      totalHours, unitAddedValue, unitSalary, unitProfit,
      month
    };
  }

  // 格式化金额 — 委托给 Currency 模块（含汇率折算）
  function fmtMoney(v) {
    return Currency.fmtMoney(v);
  }
  function fmtHour(v) {
    return (Math.round(v * 10) / 10) + ' h';
  }
  function fmtRate(v) {
    return Currency.fmtRate(v);
  }
  // 获取当前货币符号
  function getCurrency() {
    return Currency.getSymbol();
  }

  return { calculateMetrics, currentMonth, currentMonthRange, fmtMoney, fmtHour, fmtRate, getCurrency };
})();
