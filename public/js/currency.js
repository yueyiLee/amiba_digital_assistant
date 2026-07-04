/**
 * currency.js — 汇率管理与币种转换模块
 * 数据库金额以 CNY（人民币）为基准存储，显示时按当前选择币种实时折算。
 * 汇率来源：Frankfurter API（欧洲央行数据），离线时降级为内置参考汇率。
 */
const Currency = (() => {
  const BASE = 'CNY'; // 基准货币（数据库存储币种）
  const SYMBOLS = { CNY: '¥', USD: '$', EUR: '€' };
  const NAMES = { CNY: '人民币', USD: '美元', EUR: '欧元' };

  let rates = { CNY: 1, USD: 0.1475, EUR: 0.1288 }; // 默认参考汇率
  let rateDate = '加载中...';
  let rateSource = '';
  let isRealtime = false;
  let displayCurrency = 'CNY'; // 当前显示币种
  let loaded = false;

  // 从后端获取汇率
  async function fetchRates() {
    try {
      const data = await API.get('/exchange/rate?base=CNY');
      rates = data.rates;
      rateDate = data.date;
      rateSource = data.source;
      isRealtime = data.isRealtime;
      loaded = true;
    } catch (e) {
      // 降级使用内置汇率
      rateDate = '内置参考汇率';
      rateSource = '离线模式';
      isRealtime = false;
      loaded = true;
    }
  }

  // 设置显示币种
  function setDisplayCurrency(code) {
    displayCurrency = code;
    // 同步到设置
    try {
      const settings = Storage.getSettingsSync();
      // 不修改数据库中的 currency 设置，仅在内存中切换
    } catch (e) {}
  }

  function getDisplayCurrency() { return displayCurrency; }
  function getSymbol() { return SYMBOLS[displayCurrency] || '¥'; }
  function getName() { return NAMES[displayCurrency] || displayCurrency; }
  function getRate() { return rates[displayCurrency] || 1; }
  function getRateInfo() {
    return {
      currency: displayCurrency,
      symbol: getSymbol(),
      name: getName(),
      rate: getRate(),
      date: rateDate,
      source: rateSource,
      isRealtime,
      base: BASE
    };
  }

  // 将 CNY 金额转换为当前显示币种
  function convert(amount) {
    if (displayCurrency === BASE) return amount;
    const rate = rates[displayCurrency] || 1;
    return amount * rate;
  }

  // 格式化金额（带币种符号 + 汇率折算）
  function fmtMoney(v) {
    const sign = v < 0 ? '-' : '';
    const converted = convert(Math.abs(v));
    return sign + getSymbol() + ' ' + converted.toLocaleString('zh-CN', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  // 格式化费率金额（每小时）
  function fmtRate(v) {
    const converted = convert(v);
    return getSymbol() + ' ' + converted.toLocaleString('zh-CN', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    }) + '/h';
  }

  // 格式化纯数字（无符号，用于表格中已带符号的场景）
  fmtMoney.num = function(v) {
    const sign = v < 0 ? '-' : '';
    const converted = convert(Math.abs(v));
    return sign + converted.toLocaleString('zh-CN', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  };

  function isLoaded() { return loaded; }

  return {
    fetchRates, setDisplayCurrency, getDisplayCurrency, getSymbol, getName,
    getRate, getRateInfo, convert, fmtMoney, fmtRate, isLoaded,
    SYMBOLS, NAMES, BASE
  };
})();
