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

  // 员工是否在某月「在岗」：基于状态变更历史判断
  // 规则：无历史记录（老数据/从未变更）时回退到 employees.status 当前状态，整段生效；
  //       有历史时，取该月「月初」与「月末」两个时点的最终状态，只要任一时刻在岗即视为该月有出勤，
  //       计入工时与工资。这样「离职当月(仍有出勤)」与「复职当月(已回岗)」都不会被整体漏算，
  //       而「整月都在离职区间」的月份则正确排除。
  function isActiveInMonth(emp, month) {
    if (!emp) return false;
    const mk = (month || '').slice(0, 7);
    if (!mk) return true;
    const histories = (Storage.getEmployeeStatusHistorySync && Storage.getEmployeeStatusHistorySync(emp.id)) || [];
    if (histories.length === 0) {
      // 无历史记录（老数据）：回退到当前 status 字段
      return (emp.status || 'active') !== 'left';
    }
    const [y, m] = mk.split('-').map(Number);
    const lastDay = String(new Date(y, m, 0).getDate()).padStart(2, '0');
    const startTarget = mk + '-01';
    const endTarget = mk + '-' + lastDay;
    const statusAt = (target) => {
      let applicable = 'active';
      for (const h of histories) {
        if (h.changed_date && h.changed_date <= target) applicable = h.status;
        else if (h.changed_date && h.changed_date > target) break;
      }
      return applicable;
    };
    return statusAt(startTarget) === 'active' || statusAt(endTarget) === 'active';
  }

  const pad = (n) => String(n).padStart(2, '0');
  const lastDayOf = (y, mIdx) => new Date(y, mIdx + 1, 0).getDate();

  // 月份中文标签，如 "2026年7月"
  function monthLabel(y, m) { return `${y}年${m}月`; }
  // 起止月份组合标签：同月只显示一个，否则 "2026年1月 ~ 2026年7月"
  function rangeLabel(sy, sm, ey, em) {
    const left = monthLabel(sy, sm);
    const right = monthLabel(ey, em);
    return left === right ? left : `${left} ~ ${right}`;
  }

  /**
   * 便捷时间段 → 起止日期（最小单位：月份，均给出明确的起始月~结束月）
   * @param {string} period 'month' | 'lastMonth' | 'year' | 'lastYear'
   *  - month    本月       e.g. 2026年7月 ~ 2026年7月
   *  - lastMonth 上月       e.g. 2026年6月 ~ 2026年6月
   *  - year     今年(年初至当月) e.g. 2026年1月 ~ 2026年7月
   *  - lastYear 上年       e.g. 2025年1月 ~ 2025年12月
   */
  function periodRange(period) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-based
    if (period === 'lastMonth') {
      const d = new Date(y, m - 1, 1);
      const ly = d.getFullYear(), lm = d.getMonth();
      return { start: `${ly}-${pad(lm + 1)}-01`, end: `${ly}-${pad(lm + 1)}-${pad(lastDayOf(ly, lm))}`, label: rangeLabel(ly, lm + 1, ly, lm + 1), granularity: 'day' };
    }
    if (period === 'year') {
      // 今年：年初 ~ 当月（年初至今累计 YTD）
      return { start: `${y}-01-01`, end: `${y}-${pad(m + 1)}-${pad(lastDayOf(y, m))}`, label: rangeLabel(y, 1, y, m + 1), granularity: 'month' };
    }
    if (period === 'lastYear') {
      const ly = y - 1;
      return { start: `${ly}-01-01`, end: `${ly}-12-31`, label: rangeLabel(ly, 1, ly, 12), granularity: 'month' };
    }
    // 默认：本月
    return { start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(lastDayOf(y, m))}`, label: rangeLabel(y, m + 1, y, m + 1), granularity: 'day' };
  }

  /**
   * 解析看板时间筛选（复合式：便捷段 + 自定义月份）为统一的起止范围。
   * 最小时间单位为月份；无论选择哪种方式，最终都给出明确的起始月~结束月。
   * @param {{quick?:string, startMonth?:string, endMonth?:string}} opt
   *   quick 为 'custom' 时取 startMonth/endMonth（格式 'YYYY-MM'，含起止两月）；否则走便捷段。
   */
  function resolveRange(opt) {
    opt = opt || {};
    const sm = (opt.startMonth || '').trim();
    const em = (opt.endMonth || '').trim();
    if (opt.quick === 'custom' && sm && em) {
      let [sy, smn] = sm.split('-').map(Number);
      let [ey, emn] = em.split('-').map(Number);
      // 规范化：若起始晚于结束，自动交换
      if (sy > ey || (sy === ey && smn > emn)) { [sy, ey] = [ey, sy]; [smn, emn] = [emn, smn]; }
      const sameMonth = sy === ey && smn === emn;
      return {
        start: `${sy}-${pad(smn)}-01`,
        end: `${ey}-${pad(emn)}-${pad(lastDayOf(ey, emn - 1))}`,
        label: rangeLabel(sy, smn, ey, emn),
        granularity: sameMonth ? 'day' : 'month'
      };
    }
    return periodRange(opt.quick || 'month');
  }

  /**
   * 计算全部 15 项指标
   * @param {string} unitFilter 单元筛选（'全部单元' 或具体单元名）
   * @param {object} range 时间范围对象 {start, end, label}（由 resolveRange 生成）
   */
  function calculateMetrics(unitFilter, range) {
    const { start, end, label } = range || periodRange('month');
    const txs = Storage.getTransactionsSync({ unit: unitFilter, startDate: start, endDate: end });
    const employees = Storage.getEmployeesSync();
    // 工时按所选时间段过滤（work_hours.month 为 YYYY-MM）
    const whAll = Storage.getWorkHoursSync();
    const workHours = whAll.filter(wh => {
      if (!start) return true;
      const mk = (wh.month || '').slice(0, 7);
      return mk >= start.slice(0, 7) && mk <= end.slice(0, 7);
    });

    // ---- 基础层 ----
    const salesIncome = txs.filter(t => t.type === '销售收入').reduce((s, t) => s + t.amount, 0);   // 1
    const cashIncome = txs.filter(t => t.type === '现金收入').reduce((s, t) => s + t.amount, 0);    // 2
    const totalIncome = salesIncome + cashIncome;                                                     // 3

    const materialCost = sumByType(txs, '材料采购');      // 4
    const processCost = sumByType(txs, '委托加工');       // 5
    const consumeCost = materialCost + processCost;        // 6
    const miscCost = sumByType(txs, '杂费支出');           // 7

    // ---- 收付款（按当月月度指标）----
    const cashExpense = sumByType(txs, '现金支出');         // 本期实际现金支出
    const receivable = salesIncome - cashIncome;            // 销售收入 - 现金收入

    // ---- 阿米巴核心层 ----
    const addedValue = totalIncome - consumeCost - miscCost;  // 8 附加价值（核心）

    // 总工资 = Σ(在岗员工 工时 × 时薪)
    let totalSalary = 0;                                       // 9
    workHours.forEach(wh => {
      const emp = employees.find(e => e.id === wh.employee_id);
      if (emp && isActiveInMonth(emp, wh.month)) totalSalary += wh.hours * emp.hourly_rate;
    });

    const taxCost = sumByType(txs, '税金');                   // 10
    const totalExpense = materialCost + processCost + miscCost + taxCost; // 10.5 总支出
    const payable = totalExpense - cashExpense;               // 应付款 = 总支出 - 现金支出
    const profit = addedValue - totalSalary - taxCost;        // 11 利润

    // ---- 衍生效率层 ----
    const totalHours = workHours.reduce((s, w) => {
      const emp = employees.find(e => e.id === w.employee_id);
      return s + (emp && isActiveInMonth(emp, w.month) ? w.hours : 0);
    }, 0);  // 12
    const unitAddedValue = totalHours > 0 ? addedValue / totalHours : 0;    // 13 单位时间附加值
    const unitSalary = totalHours > 0 ? totalSalary / totalHours : 0;       // 14 单位时间工资
    const unitProfit = totalHours > 0 ? profit / totalHours : 0;            // 15 单位时间利润

    return {
      salesIncome, cashIncome, totalIncome, receivable,
      materialCost, processCost, consumeCost, miscCost,
      addedValue, totalSalary, taxCost, totalExpense, cashExpense, payable, profit,
      totalHours, unitAddedValue, unitSalary, unitProfit,
      periodLabel: label
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

  return { calculateMetrics, periodRange, resolveRange, currentMonth, currentMonthRange, fmtMoney, fmtHour, fmtRate, getCurrency, isActiveInMonth };
})();
