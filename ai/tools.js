/**
 * ai/tools.js — AI 工具定义（Function Calling）与执行函数注册表
 *
 * 核心设计：工具不直接操作数据库，而是通过 apiClient 调用已有的 /api/* 路由。
 * 这样复用全部业务逻辑（校验、归属检查、状态历史回写等），
 * 并保持与前端完全一致的数据隔离安全模型。
 *
 * 每个 handler 接收 (params, token) 参数：
 *   - params: LLM 提供的工具参数
 *   - token: 用户 JWT（用于 requireAuth 认证）
 * 返回 { success, data, message }。
 */
const api = require('./api-client');

// ===== 工具定义（OpenAI Function Calling 格式）=====
const TOOL_DEFINITIONS = [
  // ---- 经营看板 / 统计 ----
  {
    type: 'function',
    function: {
      name: 'get_dashboard',
      description: '获取经营看板数据，包含阿米巴核心指标（附加价值、总利润、单位时间附加价值等）、收支明细构成、总工时与总工资。可按时间段和部门筛选。',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['month', 'lastMonth', 'year', 'lastYear'], description: '时间段：本月/上月/今年/上年，默认本月' },
          unit: { type: 'string', description: '部门名称，如"全公司"、"销售部"、"生产部"。留空表示全部部门' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_transactions',
      description: '查询收支流水记录。支持按部门、类型、日期范围筛选。返回包含客户名和商品名的完整记录。',
      parameters: {
        type: 'object',
        properties: {
          unit: { type: 'string', description: '部门名称筛选' },
          type: { type: 'string', description: '交易类型，如"销售收入"、"材料采购"、"委托加工"、"杂费支出"、"税金"等' },
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_transaction',
      description: '新增一条收支流水记录。金额正数表示收入，负数表示支出。需指定交易类型、金额、日期。',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: '金额。正数=收入，负数=支出' },
          type: { type: 'string', description: '交易类型，如"销售收入"、"材料采购"、"委托加工"、"杂费支出"、"税金"、"现金收入"等' },
          unit: { type: 'string', description: '归属部门，默认"全公司"' },
          date: { type: 'string', description: '日期 YYYY-MM-DD' },
          customer_name: { type: 'string', description: '客户名称（可选，用于关联客户）' },
          product_name: { type: 'string', description: '商品名称（可选，用于关联商品）' },
          note: { type: 'string', description: '备注' },
          category: { type: 'string', description: '支出细分类别（委托加工/杂费时使用）' },
        },
        required: ['amount', 'type', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_transaction',
      description: '修改一条收支流水记录。需提供记录ID，其余字段按需修改。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: '记录ID' },
          amount: { type: 'number' },
          type: { type: 'string' },
          unit: { type: 'string' },
          date: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_transaction',
      description: '删除一条收支流水记录。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number', description: '记录ID' } },
        required: ['id'],
      },
    },
  },

  // ---- 客户管理 ----
  {
    type: 'function',
    function: {
      name: 'get_customers',
      description: '查询客户列表。返回所有客户的基本信息（名称、类型、联系方式、地址）。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜索关键词（模糊匹配客户名称，客户端过滤）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_customer',
      description: '新增客户。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '客户名称' },
          type: { type: 'string', enum: ['个人', '公司'], description: '客户类型' },
          contact: { type: 'string', description: '联系方式' },
          address: { type: 'string', description: '地址' },
        },
        required: ['name', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_customer',
      description: '修改客户信息。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['个人', '公司'] },
          contact: { type: 'string' },
          address: { type: 'string' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_customer',
      description: '删除客户。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
  },

  // ---- 商品管理 ----
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: '查询商品列表。返回商品名称、品牌、分类、采购价、销售价等信息。',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: '搜索关键词（客户端过滤）' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_product',
      description: '新增商品。新增后会自动创建库存记录（初始数量0）。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          brand: { type: 'string' },
          unit: { type: 'string', description: '单位，如"件"、"条"等' },
          category1: { type: 'string', description: '一级分类，如"上衣"、"裤子"等' },
          category2: { type: 'string', description: '二级分类' },
          purchase_price: { type: 'number', description: '采购价' },
          sale_price: { type: 'number', description: '销售价' },
        },
        required: ['name', 'category1'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_product',
      description: '修改商品信息。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          brand: { type: 'string' },
          purchase_price: { type: 'number' },
          sale_price: { type: 'number' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_product',
      description: '删除商品。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
  },

  // ---- 库存管理 ----
  {
    type: 'function',
    function: {
      name: 'get_inventory',
      description: '查询库存列表。返回每个商品的库存数量、平均成本、库存价值。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_inventory',
      description: '更新某商品的库存数量和平均成本。需先通过商品名查找 product_id。',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'number', description: '商品ID' },
          quantity: { type: 'number', description: '库存数量' },
          avg_price: { type: 'number', description: '平均成本价' },
        },
        required: ['product_id', 'quantity'],
      },
    },
  },

  // ---- 合同管理 ----
  {
    type: 'function',
    function: {
      name: 'get_contracts',
      description: '查询合同列表。返回合同号、客户名、金额、状态、起止日期。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_contract',
      description: '新增合同。需提供客户ID（可通过 get_customers 查找）。',
      parameters: {
        type: 'object',
        properties: {
          contract_no: { type: 'string', description: '合同号' },
          customer_id: { type: 'number', description: '客户ID' },
          amount: { type: 'number', description: '合同金额' },
          status: { type: 'string', description: '状态，默认"进行中"' },
          start_date: { type: 'string', description: '开始日期' },
          end_date: { type: 'string', description: '结束日期' },
          note: { type: 'string' },
        },
        required: ['contract_no', 'customer_id', 'amount'],
      },
    },
  },

  // ---- 员工管理 ----
  {
    type: 'function',
    function: {
      name: 'get_employees',
      description: '查询员工列表。返回姓名、岗位、时薪、入职日期、在职状态。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_employee',
      description: '新增员工。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          position: { type: 'string', description: '岗位' },
          hourly_rate: { type: 'number', description: '时薪' },
          join_date: { type: 'string', description: '入职日期 YYYY-MM-DD' },
        },
        required: ['name', 'hourly_rate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_employee_status',
      description: '设置员工在职状态（离职/复职）。需提供员工ID。',
      parameters: {
        type: 'object',
        properties: {
          employee_id: { type: 'number', description: '员工ID' },
          status: { type: 'string', enum: ['active', 'left'] },
          leave_date: { type: 'string', description: '离职/复职日期' },
          note: { type: 'string' },
        },
        required: ['employee_id', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_work_hours',
      description: '记录员工某月工时。月工资 = 工时 × 时薪。需提供员工ID。',
      parameters: {
        type: 'object',
        properties: {
          employee_id: { type: 'number', description: '员工ID' },
          hours: { type: 'number', description: '工时数' },
          month: { type: 'string', description: '月份 YYYY-MM' },
        },
        required: ['employee_id', 'hours', 'month'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_work_hours',
      description: '查询工时记录。可按月份筛选。',
      parameters: {
        type: 'object',
        properties: { month: { type: 'string', description: '月份 YYYY-MM' } },
      },
    },
  },

  // ---- 经营分析（基于 transactions 数据二次计算） ----
  {
    type: 'function',
    function: {
      name: 'get_analysis_summary',
      description: '获取经营分析摘要：本期收入/支出分类汇总、利润、附加价值。通过查询 transactions 后在服务端计算。',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          endDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          unit: { type: 'string', description: '部门筛选' },
        },
      },
    },
  },

  // ---- 设置 ----
  {
    type: 'function',
    function: {
      name: 'get_settings',
      description: '获取当前账号的系统设置（部门列表、币种、导出格式等）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_expense_types',
      description: '获取收支类型（费用类型）配置列表。',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ===== 工具执行函数（全部通过 apiClient 调用已有 RESTful API）=====

const TOOL_HANDLERS = {
  // ---- 经营看板：调用 get_transactions 获取数据后计算 ----
  async get_dashboard(params, token) {
    const period = params.period || 'month';
    const now = new Date();
    let startDate, endDate, monthStr;

    if (period === 'month') {
      const y = now.getFullYear(), m = now.getMonth();
      startDate = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m + 1, 0).getDate();
      endDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      monthStr = `${y}-${String(m + 1).padStart(2, '0')}`;
    } else if (period === 'lastMonth') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      endDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } else if (period === 'year') {
      const y = now.getFullYear();
      startDate = `${y}-01-01`;
      endDate = `${y}-12-31`;
    } else if (period === 'lastYear') {
      const y = now.getFullYear() - 1;
      startDate = `${y}-01-01`;
      endDate = `${y}-12-31`;
    }

    // 调用 GET /api/transactions 获取流水
    const query = { startDate, endDate };
    if (params.unit && params.unit !== '全部单元') query.unit = params.unit;
    const txResp = await api.get('/api/transactions', query, token);
    if (txResp.status >= 400) {
      return { success: false, message: txResp.data.error || '获取收支数据失败' };
    }
    const transactions = txResp.data;

    // 调用 GET /api/workhours 获取工时（仅月维度有意义）
    let workHours = [];
    if (monthStr) {
      const whResp = await api.get('/api/workhours', { month: monthStr }, token);
      if (whResp.status < 400) workHours = whResp.data;
    }

    // 分类汇总
    const sumByType = (type) => transactions.filter(t => t.type === type).reduce((s, t) => s + Math.abs(t.amount), 0);
    const salesIncome = sumByType('销售收入');
    const cashIncome = sumByType('现金收入');
    const otherIncome = sumByType('其他收入');
    const totalIncome = salesIncome + cashIncome + otherIncome;
    const receivable = salesIncome - cashIncome;

    const materialExpense = sumByType('材料采购');
    const processExpense = sumByType('委托加工');
    const miscExpense = sumByType('杂费支出');
    const taxExpense = sumByType('税金');
    const totalExpense = materialExpense + processExpense + miscExpense + taxExpense;
    const cashExpense = sumByType('现金支出');
    const payable = totalExpense - cashExpense;

    const addedValue = totalIncome - materialExpense - processExpense - miscExpense - taxExpense;
    const totalHours = workHours.reduce((s, w) => s + (w.hours || 0), 0);
    const totalSalary = workHours.reduce((s, w) => s + (w.hours || 0) * (w.hourly_rate || 0), 0);
    const unitAddedValue = totalHours > 0 ? addedValue / totalHours : 0;
    const totalProfit = addedValue - totalSalary - taxExpense;
    const unitProfit = totalHours > 0 ? totalProfit / totalHours : 0;

    return {
      success: true,
      data: {
        period: { startDate, endDate, label: `${startDate} ~ ${endDate}` },
        core: { addedValue, unitAddedValue, totalProfit, unitProfit },
        income: { salesIncome, cashIncome, otherIncome, totalIncome, receivable },
        expense: { materialExpense, processExpense, miscExpense, taxExpense, totalExpense, cashExpense, payable },
        labor: { totalHours, totalSalary, unitSalary: totalHours > 0 ? totalSalary / totalHours : 0 },
      },
      message: `经营看板数据（${startDate} 至 ${endDate}）`,
    };
  },

  // ---- 收支流水 ----
  async get_transactions(params, token) {
    const query = {};
    if (params.unit) query.unit = params.unit;
    if (params.type) query.type = params.type;
    if (params.startDate) query.startDate = params.startDate;
    if (params.endDate) query.endDate = params.endDate;
    const resp = await api.get('/api/transactions', query, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    const rows = resp.data;
    return { success: true, data: rows, message: `找到 ${rows.length} 条收支记录` };
  },

  async add_transaction(params, token) {
    const body = {
      amount: params.amount,
      type: params.type,
      unit: params.unit || '全公司',
      date: params.date,
      note: params.note || '',
      category: params.category || '',
    };

    // 通过客户名查找 customer_id
    if (params.customer_name) {
      const custResp = await api.get('/api/customers', {}, token);
      if (custResp.status < 400) {
        const found = custResp.data.find(c => c.name === params.customer_name);
        if (found) body.customer_id = found.id;
      }
    }

    // 通过商品名查找 product_id
    if (params.product_name) {
      const prodResp = await api.get('/api/products', {}, token);
      if (prodResp.status < 400) {
        const found = prodResp.data.find(p => p.name === params.product_name);
        if (found) body.product_id = found.id;
      }
    }

    const resp = await api.post('/api/transactions', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `已新增收支记录：${params.type} ${params.amount}元` };
  },

  async update_transaction(params, token) {
    const body = {};
    if (params.amount !== undefined) body.amount = params.amount;
    if (params.type !== undefined) body.type = params.type;
    if (params.unit !== undefined) body.unit = params.unit;
    if (params.date !== undefined) body.date = params.date;
    if (params.note !== undefined) body.note = params.note;
    const resp = await api.put(`/api/transactions/${params.id}`, body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已修改记录 #${params.id}` };
  },

  async delete_transaction(params, token) {
    const resp = await api.del(`/api/transactions/${params.id}`, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已删除记录 #${params.id}` };
  },

  // ---- 客户 ----
  async get_customers(params, token) {
    const resp = await api.get('/api/customers', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    let rows = resp.data;
    // 客户端关键词过滤（API 不支持搜索参数）
    if (params.keyword) {
      const kw = params.keyword.toLowerCase();
      rows = rows.filter(c => c.name.toLowerCase().includes(kw));
    }
    return { success: true, data: rows, message: `找到 ${rows.length} 个客户` };
  },

  async add_customer(params, token) {
    const body = { name: params.name, type: params.type, contact: params.contact || '', address: params.address || '' };
    const resp = await api.post('/api/customers', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `已新增客户：${params.name}` };
  },

  async update_customer(params, token) {
    const body = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.type !== undefined) body.type = params.type;
    if (params.contact !== undefined) body.contact = params.contact;
    if (params.address !== undefined) body.address = params.address;
    const resp = await api.put(`/api/customers/${params.id}`, body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已修改客户 #${params.id}` };
  },

  async delete_customer(params, token) {
    const resp = await api.del(`/api/customers/${params.id}`, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已删除客户 #${params.id}` };
  },

  // ---- 商品 ----
  async get_products(params, token) {
    const resp = await api.get('/api/products', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    let rows = resp.data;
    if (params.keyword) {
      const kw = params.keyword.toLowerCase();
      rows = rows.filter(p => p.name.toLowerCase().includes(kw) || (p.brand || '').toLowerCase().includes(kw));
    }
    return { success: true, data: rows, message: `找到 ${rows.length} 个商品` };
  },

  async add_product(params, token) {
    const body = {
      name: params.name,
      brand: params.brand || '',
      unit: params.unit || '件',
      category1: params.category1,
      category2: params.category2 || '',
      purchase_price: params.purchase_price || 0,
      sale_price: params.sale_price || 0,
    };
    const resp = await api.post('/api/products', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `已新增商品：${params.name}` };
  },

  async update_product(params, token) {
    const body = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.brand !== undefined) body.brand = params.brand;
    if (params.purchase_price !== undefined) body.purchase_price = params.purchase_price;
    if (params.sale_price !== undefined) body.sale_price = params.sale_price;
    const resp = await api.put(`/api/products/${params.id}`, body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已修改商品 #${params.id}` };
  },

  async delete_product(params, token) {
    const resp = await api.del(`/api/products/${params.id}`, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已删除商品 #${params.id}` };
  },

  // ---- 库存 ----
  async get_inventory(params, token) {
    const resp = await api.get('/api/inventory', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `共 ${resp.data.length} 条库存记录` };
  },

  async update_inventory(params, token) {
    const body = { product_id: params.product_id, quantity: params.quantity };
    if (params.avg_price !== undefined) body.avg_price = params.avg_price;
    const resp = await api.post('/api/inventory', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已更新库存：商品ID ${params.product_id}，数量 ${params.quantity}` };
  },

  // ---- 合同 ----
  async get_contracts(params, token) {
    const resp = await api.get('/api/contracts', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `共 ${resp.data.length} 个合同` };
  },

  async add_contract(params, token) {
    const body = {
      contract_no: params.contract_no,
      customer_id: params.customer_id,
      amount: params.amount,
      status: params.status || '进行中',
      start_date: params.start_date || '',
      end_date: params.end_date || '',
      note: params.note || '',
    };
    const resp = await api.post('/api/contracts', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `已新增合同：${params.contract_no}` };
  },

  // ---- 员工 ----
  async get_employees(params, token) {
    const resp = await api.get('/api/employees', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    let rows = resp.data;
    // 客户端状态过滤（API 不支持 status 参数）
    if (params.status && params.status !== 'all') {
      rows = rows.filter(e => (e.status || 'active') === params.status);
    }
    return { success: true, data: rows, message: `找到 ${rows.length} 名员工` };
  },

  async add_employee(params, token) {
    const body = {
      name: params.name,
      position: params.position || '',
      hourly_rate: params.hourly_rate,
      join_date: params.join_date || '',
    };
    const resp = await api.post('/api/employees', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `已新增员工：${params.name}（${params.position || '未设岗位'}，时薪${params.hourly_rate}元）` };
  },

  async set_employee_status(params, token) {
    const body = {
      status: params.status,
      leave_date: params.leave_date || '',
      note: params.note || '',
    };
    const resp = await api.patch(`/api/employees/${params.employee_id}/status`, body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    const action = params.status === 'left' ? '离职' : '复职';
    return { success: true, message: `已办理员工 #${params.employee_id} ${action}` };
  },

  async record_work_hours(params, token) {
    const body = {
      employee_id: params.employee_id,
      hours: params.hours,
      month: params.month,
    };
    const resp = await api.post('/api/workhours', body, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, message: `已记录员工 #${params.employee_id} ${params.month} 月工时：${params.hours}小时` };
  },

  async get_work_hours(params, token) {
    const query = {};
    if (params.month) query.month = params.month;
    const resp = await api.get('/api/workhours', query, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `找到 ${resp.data.length} 条工时记录` };
  },

  // ---- 经营分析摘要（基于 transactions 二次计算） ----
  async get_analysis_summary(params, token) {
    const query = {};
    if (params.startDate) query.startDate = params.startDate;
    if (params.endDate) query.endDate = params.endDate;
    if (params.unit) query.unit = params.unit;
    const resp = await api.get('/api/transactions', query, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    const txns = resp.data;

    const sumByType = (type) => txns.filter(t => t.type === type).reduce((s, t) => s + Math.abs(t.amount), 0);
    const salesIncome = sumByType('销售收入');
    const cashIncome = sumByType('现金收入');
    const otherIncome = sumByType('其他收入');
    const totalIncome = salesIncome + cashIncome + otherIncome;

    const materialExpense = sumByType('材料采购');
    const processExpense = sumByType('委托加工');
    const miscExpense = sumByType('杂费支出');
    const taxExpense = sumByType('税金');
    const totalExpense = materialExpense + processExpense + miscExpense + taxExpense;

    const addedValue = totalIncome - materialExpense - processExpense - miscExpense - taxExpense;

    return {
      success: true,
      data: {
        income: { salesIncome, cashIncome, otherIncome, totalIncome, receivable: salesIncome - cashIncome },
        expense: { materialExpense, processExpense, miscExpense, taxExpense, totalExpense },
        addedValue,
        transactionCount: txns.length,
      },
      message: `经营分析摘要（${txns.length} 条记录）`,
    };
  },

  // ---- 设置 ----
  async get_settings(params, token) {
    const resp = await api.get('/api/settings', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: '当前账号设置' };
  },

  async get_expense_types(params, token) {
    const resp = await api.get('/api/expense-types', {}, token);
    if (resp.status >= 400) return { success: false, message: resp.data.error };
    return { success: true, data: resp.data, message: `共 ${resp.data.length} 个收支类型` };
  },
};

module.exports = { TOOL_DEFINITIONS, TOOL_HANDLERS };
