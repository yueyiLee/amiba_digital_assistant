/**
 * export.js — 数据导出功能
 * 支持将收支明细、合同、客户、商品、员工数据导出为 CSV/JSON 文件。
 * 导出范围：当前页面显示的全部数据。
 */
const Export = (() => {

  function getFormat() {
    try {
      const s = Storage.getSettingsSync();
      return s.export_format || 'CSV';
    } catch (e) { return 'CSV'; }
  }

  // 触发文件下载
  function download(content, filename, mime) {
    const blob = new Blob(['\ufeff' + content], { type: mime || 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 转义 CSV 字段
  function csvField(v) {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toCSV(rows, headers) {
    const head = headers.map(h => csvField(h.label)).join(',');
    const body = rows.map(row =>
      headers.map(h => csvField(row[h.key])).join(',')
    ).join('\n');
    return head + '\n' + body;
  }

  function toJSON(rows) {
    return JSON.stringify(rows, null, 2);
  }

  function doExport(rows, headers, name) {
    if (!rows || rows.length === 0) {
      App.toast('没有可导出的数据', 'warning');
      return;
    }
    const fmt = getFormat();
    const ts = new Date().toISOString().slice(0, 10);
    if (fmt === 'JSON') {
      download(toJSON(rows), `${name}_${ts}.json`, 'application/json');
    } else {
      download(toCSV(rows, headers), `${name}_${ts}.csv`, 'text/csv;charset=utf-8;');
    }
    App.toast(`已导出 ${rows.length} 条数据（${fmt}格式）`, 'success');
  }

  // 导出收支明细（rows 可选：传入则导出该查询结果，否则导出全部）
  function exportTransactions(src) {
    const txs = (src && src.length) ? src : Storage.getTransactionsSync();
    const cur = Calculator.getCurrency();
    const rows = txs.map(t => ({
      date: t.date, type: t.type, direction: t.amount > 0 ? '收入' : '支出',
      amount: Math.abs(t.amount), currency: cur,
      unit: t.unit, customer: t.customer_name || '', product: t.product_name || '',
      category: t.category || '', note: t.note || ''
    }));
    doExport(rows, [
      { key: 'date', label: '日期' }, { key: 'type', label: '类型' },
      { key: 'direction', label: '收支方向' }, { key: 'amount', label: '金额' },
      { key: 'currency', label: '币种' }, { key: 'unit', label: '归属部门' },
      { key: 'customer', label: '客户' }, { key: 'product', label: '商品' },
      { key: 'category', label: '支出类别' }, { key: 'note', label: '备注' }
    ], '收支明细');
  }

  // 导出合同（rows 可选：当前查询结果）
  function exportContracts(src) {
    const list = (src && src.length) ? src : Storage.getContractsSync();
    const rows = list.map(c => ({
      contract_no: c.contract_no, customer: c.customer_name || '',
      amount: c.amount, status: c.status,
      start_date: c.start_date || '', end_date: c.end_date || '', note: c.note || ''
    }));
    doExport(rows, [
      { key: 'contract_no', label: '合同编号' }, { key: 'customer', label: '客户' },
      { key: 'amount', label: '金额' }, { key: 'status', label: '状态' },
      { key: 'start_date', label: '开始日期' }, { key: 'end_date', label: '结束日期' },
      { key: 'note', label: '备注' }
    ], '合同');
  }

  // 导出客户（rows 可选：当前查询结果）
  function exportCustomers(src) {
    const list = (src && src.length) ? src : Storage.getCustomersSync();
    const rows = list.map(c => ({
      name: c.name, type: c.type, contact: c.contact || '', address: c.address || ''
    }));
    doExport(rows, [
      { key: 'name', label: '客户名称' }, { key: 'type', label: '类型' },
      { key: 'contact', label: '联系方式' }, { key: 'address', label: '地址' }
    ], '客户');
  }

  // 导出商品（rows 可选：当前查询结果）
  function exportProducts(src) {
    const list = (src && src.length) ? src : Storage.getProductsSync();
    const rows = list.map(p => ({
      name: p.name, brand: p.brand || '', category1: p.category1, category2: p.category2 || '',
      unit: p.unit, purchase_price: p.purchase_price, sale_price: p.sale_price
    }));
    doExport(rows, [
      { key: 'name', label: '商品名称' }, { key: 'brand', label: '品牌' },
      { key: 'category1', label: '一级分类' }, { key: 'category2', label: '二级分类' },
      { key: 'unit', label: '单位' }, { key: 'purchase_price', label: '采购价' },
      { key: 'sale_price', label: '销售价' }
    ], '商品');
  }

  // 导出员工（rows 可选：传入已计算的行则直接使用，否则按当前月计算工时工资）
  function exportEmployees(src) {
    const cur = Calculator.getCurrency();
    let data;
    if (src && src.length && 'hours' in src[0]) {
      data = src; // 页面已计算好（含所选月份工时/工资）
    } else {
      const employees = (src && src.length) ? src : Storage.getEmployeesSync();
      const month = Calculator.currentMonth();
      const workHours = Storage.getWorkHoursSync(month);
      data = employees.map(emp => {
        const wh = workHours.find(w => w.employee_id === emp.id);
        const hours = wh ? wh.hours : 0;
        return {
          name: emp.name, position: emp.position || '',
          hourly_rate: emp.hourly_rate, currency: cur,
          month, hours, salary: Math.round(hours * emp.hourly_rate),
          join_date: emp.join_date || ''
        };
      });
    }
    doExport(data, [
      { key: 'name', label: '姓名' }, { key: 'position', label: '岗位' },
      { key: 'hourly_rate', label: '时薪' }, { key: 'currency', label: '币种' },
      { key: 'month', label: '月份' }, { key: 'hours', label: '工时' },
      { key: 'salary', label: '工资' }, { key: 'join_date', label: '入职日期' }
    ], '员工');
  }

  // 导出员工档案（姓名/岗位/时薪/入职日期，无工时工资）
  function exportEmployeeRoster(src) {
    const cur = Calculator.getCurrency();
    const list = (src && src.length && 'name' in src[0])
      ? src
      : Storage.getEmployeesSync().map(emp => ({
          name: emp.name, position: emp.position || '',
          hourly_rate: emp.hourly_rate, currency: cur, join_date: emp.join_date || ''
        }));
    doExport(list, [
      { key: 'name', label: '姓名' }, { key: 'position', label: '岗位' },
      { key: 'hourly_rate', label: '时薪' }, { key: 'currency', label: '币种' },
      { key: 'join_date', label: '入职日期' }
    ], '员工档案');
  }

  return { exportTransactions, exportContracts, exportCustomers, exportProducts, exportEmployees, exportEmployeeRoster };
})();
