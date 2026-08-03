/**
 * drizzle/queries/index.ts — 统一导出所有查询辅助函数
 */
export * from './auth.queries';
export * from './users.queries';
export * from './customers.queries';
export * from './products.queries';
export {
  listInventory, findInventoryByProduct, findInventoryById,
  createInventory, updateInventory, upsertInventory, deleteInventory,
  // getInventoryValue 从 inventory.queries 导出，analysis.queries 中同名函数仅内部使用
  getInventoryValue,
} from './inventory.queries';
export * from './transactions.queries';
export * from './contracts.queries';
export * from './employees.queries';
export {
  // 只导出 analysis 特有函数，避免与 inventory 冲突
  getTypeAggregation, getSalaryHoursAgg, getCustomerAgg, getProductAgg,
  getStaleInventory, getUnitTop, getCustomerAnalysis, getCustomerLastDates,
  getProductSaleAgg, getProductPurchaseAgg, getContractItemAgg, getPriceTrend,
  getContractAnalysis, getContractPayments, getExpenseCompose,
  getMonthlyExpense, getExpenseByUnit, getUnitAddedValue, getUnitContribs,
  getProductSkuCount, getProductTop10, getStockByProductIds,
  getAvgCostByProductIds, getAllProductsWithStock, getProductGmByPids,
  countCustomers, getTotalSaleAmount, buildTxFilter,
} from './analysis.queries';
export * from './seed.queries';
