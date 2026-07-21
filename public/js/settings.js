/**
 * settings.js — 设置页面（PRD 5.5）
 * 阿米巴单元开关 + 经营单元管理 + 基础参数。
 */
const Settings = (() => {

  function render() {
    renderDept();
    renderDisplay();
  }

  // 部门设置页：阿米巴独立核算开关 + 部门管理
  function renderDept() {
    const s = Storage.getSettingsSync();
    const amoebaEnabled = s.amoeba_enabled !== 'false';
    document.getElementById('amoebaSwitch').checked = amoebaEnabled;
    document.getElementById('amoebaTag').textContent = amoebaEnabled ? '已启用' : '未启用';
    document.getElementById('amoebaTag').style.background = amoebaEnabled ? '#dcfce7' : '#f1f5f9';
    document.getElementById('amoebaTag').style.color = amoebaEnabled ? '#059669' : '#64748b';
    renderUnitList();
  }

  // 显示与导出设置页：币种 + 导出格式
  function renderDisplay() {
    const s = Storage.getSettingsSync();
    document.getElementById('setCurrency').value = s.currency || '¥';
    document.getElementById('setExport').value = s.export_format || 'CSV';
  }

  function renderUnitList() {
    const s = Storage.getSettingsSync();
    let units = [], activeUnits = [];
    try { units = JSON.parse(s.units || '["全公司"]'); } catch (e) { units = ['全公司']; }
    try { activeUnits = JSON.parse(s.active_units || '["全公司"]'); } catch (e) { activeUnits = ['全公司']; }

    const container = document.getElementById('unitList');
    container.innerHTML = units.map(u => `
      <div class="check-item">
        <input type="checkbox" ${activeUnits.includes(u) ? 'checked' : ''} data-unit="${u}" ${u === '全公司' ? 'disabled' : ''}>
        <span>${u}</span>
        ${u !== '全公司' && Auth.isAdmin() ? `<span class="del-unit" onclick="Settings.delUnit('${u}')">×</span>` : ''}
      </div>`).join('');
  }

  async function save() {
    const amoebaEnabled = document.getElementById('amoebaSwitch').checked;
    const currency = document.getElementById('setCurrency').value;
    const exportFormat = document.getElementById('setExport').value;
    const activeUnits = Array.from(document.querySelectorAll('.check-item input[type=checkbox]:checked'))
      .map(cb => cb.dataset.unit);
    if (!activeUnits.includes('全公司')) activeUnits.unshift('全公司');

    try {
      await API.put('/settings', {
        amoeba_enabled: String(amoebaEnabled),
        active_units: JSON.stringify(activeUnits),
        currency,
        export_format: exportFormat
      });
      await Storage.refreshCache();
      // 同步币种到 Currency 模块（全站金额按实时汇率折算显示）
      const curCode = currency === '$' ? 'USD' : (currency === '€' ? 'EUR' : 'CNY');
      Currency.setDisplayCurrency(curCode);
      // 全局刷新所有页面以联动汇率折算
      App.refreshAll();
      App.toast('设置已保存，金额已按当前币种汇率折算', 'success');
    } catch (err) {
      App.toast('保存失败：' + err.message, 'error');
    }
  }

  async function addUnit() {
    const input = document.getElementById('newUnitInput');
    const name = input.value.trim();
    if (!name) return App.toast('单元名称不能为空', 'error');
    let units = Storage.getUnitList();
    if (units.includes(name)) return App.toast('单元名称已存在', 'error');
    units.push(name);
    let active = Storage.getActiveUnits();
    active.push(name);
    await API.put('/settings', {
      units: JSON.stringify(units),
      active_units: JSON.stringify(active)
    });
    await Storage.refreshCache();
    input.value = '';
    renderUnitList();
    App.toast('单元已添加', 'success');
  }

  async function delUnit(name) {
    if (!confirm(`确认删除单元「${name}」？`)) return;
    let units = Storage.getUnitList().filter(u => u !== name);
    let active = Storage.getActiveUnits().filter(u => u !== name);
    await API.put('/settings', {
      units: JSON.stringify(units),
      active_units: JSON.stringify(active)
    });
    await Storage.refreshCache();
    renderUnitList();
    App.toast('单元已删除', 'success');
  }

  async function resetData() {
    if (!confirm('确认重置为示例数据？当前业务数据将被清空（用户账号保留）。')) return;
    try {
      await API.post('/init/sample');
      await Storage.refreshCache();
      App.refreshAll();
      App.toast('示例数据已重置', 'success');
    } catch (err) {
      App.toast('重置失败：' + err.message, 'error');
    }
  }

  function bind() {
    document.getElementById('amoebaSwitch').addEventListener('change', (e) => {
      const on = e.target.checked;
      document.getElementById('amoebaTag').textContent = on ? '已启用' : '未启用';
      document.getElementById('amoebaTag').style.background = on ? '#dcfce7' : '#f1f5f9';
      document.getElementById('amoebaTag').style.color = on ? '#059669' : '#64748b';
    });
    document.getElementById('saveSettingsBtn').addEventListener('click', save);
    document.getElementById('addUnitBtn').addEventListener('click', addUnit);
    document.getElementById('resetDataBtn').addEventListener('click', resetData);
  }

  return { render, renderDept, renderDisplay, bind, delUnit };
})();
