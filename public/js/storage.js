/**
 * storage.js — 前端内存缓存层（PRD 第 20 章）
 * 全量加载 + 同步读取 + 写后即刷新，保障看板流畅渲染。
 */
const Storage = (() => {
  let cached = {
    transactions: [], customers: [], products: [], inventory: [],
    employees: [], workHours: [], contracts: [], settings: {},
    categories: [], users: []
  };

  // 全量加载（Promise.all 并发）
  async function refreshCache() {
    const [
      transactions, customers, products, inventory,
      employees, workHours, contracts, settings, categories, users
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
      API.get('/users').catch(() => [])  // 非 admin 可能无权限
    ]);
    cached = { transactions, customers, products, inventory, employees, workHours, contracts, settings, categories, users };
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
    getTransactionsSync, getEmployeesSync, getWorkHoursSync,
    getCustomersSync, getProductsSync, getInventorySync, getContractsSync,
    getSettingsSync, getCategoriesSync, getUsersSync,
    getCustomerOptions, getProductOptions, getUnitList, getActiveUnits,
    _cached: () => cached
  };
})();
