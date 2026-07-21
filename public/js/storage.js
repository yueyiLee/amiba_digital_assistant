/**
 * storage.js — 前端内存缓存层（PRD 第 20 章）
 * 全量加载 + 同步读取 + 写后即刷新，保障看板流畅渲染。
 */
const Storage = (() => {
  let cached = {
    transactions: [], customers: [], products: [], inventory: [],
    employees: [], workHours: [], contracts: [], settings: {},
    categories: [], users: [], expenseItems: [], expenseTypes: [],
    employeeStatusHistory: []
  };

  // 全量加载（Promise.all 并发）
  async function refreshCache() {
    const [
      transactions, customers, products, inventory,
      employees, workHours, contracts, settings, categories, users, expenseItems, expenseTypes,
      employeeStatusHistory
    ] = await Promise.all([
      API.get('/transactions'),
      API.get('/customers'),
      API.get('/products'),
      API.get('/inventory'),
      API.get('/employees'),
      API.get('/workhours'),
      API.get('/contracts'),
      API.get('/settings'),
      API.get('/categories'),
      API.get('/users').catch(() => []),
      API.get('/expense-items').catch(() => []),
      API.get('/expense-types').catch(() => []),
      API.get('/employee-status-history-all').catch(() => [])
    ]);
    cached = { transactions, customers, products, inventory, employees, workHours, contracts, settings, categories, users, expenseItems, expenseTypes, employeeStatusHistory };
    return cached;
  }

  // ---- 同步读取（带筛选）----
  function getTransactionsSync(filter) {
    let list = cached.transactions.slice();
    if (!filter) return list;
    if (filter.unit && filter.unit !== '全部单元') list = list.filter(t => t.unit === filter.unit);
    if (filter.type) list = list.filter(t => t.type === filter.type);
    if (filter.startDate) list = list.filter(t => t.date >= filter.startDate);
    if (filter.endDate) list = list.filter(t => t.date <= filter.endDate);
    return list;
  }

  function getEmployeesSync() { return cached.employees.slice(); }
  function getEmployeeStatusHistorySync(employeeId) {
    let list = cached.employeeStatusHistory.slice();
    if (employeeId != null) list = list.filter(h => h.employee_id === employeeId);
    return list;
  }
  function getWorkHoursSync(month) {
    let list = cached.workHours.slice();
    if (month) list = list.filter(w => w.month === month);
    return list;
  }
  function getCustomersSync() { return cached.customers.slice(); }
  function getProductsSync() { return cached.products.slice(); }
  function getInventorySync() { return cached.inventory.slice(); }
  function getContractsSync() { return cached.contracts.slice(); }
  function getSettingsSync() { return Object.assign({}, cached.settings); }
  function getCategoriesSync() { return cached.categories.slice(); }
  function getUsersSync() { return cached.users.slice(); }
  // 支出项预设下拉（按 kind 过滤：'processing' 委托加工 | 'misc' 杂费）
  function getExpenseItemsSync(kind) {
    return cached.expenseItems.filter(e => e.kind === kind).map(e => ({ id: e.id, name: e.name, note: e.note || '' }));
  }
  // 收支类型（费用类型）配置：可按方向、是否仅启用过滤
  function getExpenseTypesSync(direction, opts) {
    let list = cached.expenseTypes.slice();
    if (direction) list = list.filter(t => t.direction === direction);
    if (opts && opts.enabledOnly) list = list.filter(t => t.enabled);
    return list;
  }

  // ---- 选项下拉数据 ----
  function getCustomerOptions() { return cached.customers.map(c => ({ id: c.id, name: c.name })); }
  function getProductOptions() { return cached.products.map(p => ({ id: p.id, name: p.name })); }
  function getUnitList() {
    const s = cached.settings;
    try { return JSON.parse(s.units || '["全公司"]'); }
    catch (e) { return ['全公司']; }
  }
  function getActiveUnits() {
    const s = cached.settings;
    try { return JSON.parse(s.active_units || '["全公司"]'); }
    catch (e) { return ['全公司']; }
  }

  return {
    refreshCache,
    getTransactionsSync, getEmployeesSync, getEmployeeStatusHistorySync, getWorkHoursSync,
    getCustomersSync, getProductsSync, getInventorySync, getContractsSync,
    getSettingsSync, getCategoriesSync, getUsersSync,
    getCustomerOptions, getProductOptions, getUnitList, getActiveUnits,
    getExpenseItemsSync,
    getExpenseTypesSync,
    _cached: () => cached
  };
})();
