/**
 * employees.js — 员工页面（PRD 5.4）
 * 员工列表 + 月度工时与工资表（月工资 = 月工时 × 时薪）+ 添加员工 Modal。
 */
const Employees = (() => {
  let selectedMonth = '';

  function render() {
    renderMonthSelector();
    renderTable();
  }

  function renderMonthSelector() {
    const sel = document.getElementById('empMonth');
    const months = generateMonthOptions();
    if (!selectedMonth) selectedMonth = Calculator.currentMonth();
    sel.innerHTML = months.map(m => `<option value="${m}" ${m === selectedMonth ? 'selected' : ''}>${m.slice(0, 4)}年${m.slice(5)}月</option>`).join('');
  }

  function generateMonthOptions() {
    const arr = [];
    const now = new Date();
    const endYear = now.getFullYear();
    const endMonth = now.getMonth() + 1; // 1-12
    // 查询月份范围固定从 2025 年 1 月开始，直到当前月份
    const startYear = 2025;
    const startMonth = 1;
    let y = startYear, m = startMonth;
    while (y < endYear || (y === endYear && m <= endMonth)) {
      arr.push(`${y}-${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return arr;
  }

  function renderTable() {
    const employees = Storage.getEmployeesSync();
    const workHours = Storage.getWorkHoursSync(selectedMonth);

    // 汇总
    let totalHours = 0, totalSalary = 0;
    const rows = employees.map(emp => {
      const wh = workHours.find(w => w.employee_id === emp.id);
      const hours = wh ? wh.hours : 0;
      const salary = hours * emp.hourly_rate;
      totalHours += hours;
      totalSalary += salary;
      return { emp, hours, salary, whId: wh ? wh.id : null };
    });

    document.getElementById('empCount').textContent = employees.length;
    document.getElementById('empTotalHours').textContent = Calculator.fmtHour(totalHours);
    document.getElementById('empTotalSalary').textContent = Calculator.fmtMoney(totalSalary);

    const tbl = document.getElementById('empTable');
    if (rows.length === 0) { tbl.innerHTML = '<tr><td colspan="6" class="empty-state">请先添加员工，再录入工时</td></tr>'; return; }

    const canEdit = Auth.canEdit();
    tbl.innerHTML = `<thead><tr><th>姓名</th><th>岗位</th><th>时薪</th><th>月工时</th><th>月工资</th><th>操作</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${r.emp.name}</td>
        <td>${r.emp.position || '—'}</td>
        <td>${Calculator.fmtMoney(r.emp.hourly_rate)}</td>
        <td>${canEdit
          ? `<input type="number" class="form-input emp-hours-input" style="width:90px;text-align:center;" value="${r.hours}" min="0" step="0.5" data-emp="${r.emp.id}" data-month="${selectedMonth}">`
          : r.hours + ' h'}</td>
        <td class="amt pos">${Calculator.fmtMoney(r.salary)}</td>
        <td>${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="Employees.openEditModal(${r.emp.id})">编辑</button> <button class="btn btn-danger btn-sm" onclick="Employees.del(${r.emp.id})">删</button>` : '—'}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">合计</td><td>${Calculator.fmtHour(totalHours)}</td><td class="amt pos">${Calculator.fmtMoney(totalSalary)}</td><td>—</td></tr></tfoot>`;

    // 工时输入实时保存
    if (canEdit) {
      document.querySelectorAll('.emp-hours-input').forEach(input => {
        input.addEventListener('change', async (e) => {
          const empId = Number(e.target.dataset.emp);
          const month = e.target.dataset.month;
          const hours = parseFloat(e.target.value) || 0;
          try {
            await API.post('/workhours', { employee_id: empId, hours, month });
            await Storage.refreshCache();
            renderTable();
            // 工时变更通知看板
            if (App.currentPage === 'dashboard') Dashboard.render();
          } catch (err) { App.toast('保存失败：' + err.message, 'error'); }
        });
      });
    }
  }

  // 服装行业常用岗位预设
  const POSITION_PRESETS = ['管理员', '裁剪工', '缝纫工', '包装工', '质检员', '库管员', '设计师', '其他'];

  function openModal() {
    const body = `
      <div class="form-group"><label class="form-label">员工姓名 <span class="req">*</span></label><input type="text" class="form-input" id="m-name"></div>
      <div class="form-group"><label class="form-label">岗位</label>
        <select class="form-select" id="m-position">
          ${POSITION_PRESETS.map(p => `<option value="${p}">${p}</option>`).join('')}
        </select>
        <input type="text" class="form-input" id="m-positionCustom" placeholder="或输入自定义岗位..." style="margin-top:4px;display:none;">
      </div>
      <div class="form-group"><label class="form-label">时薪（¥/小时，按人民币录入）<span class="req">*</span></label><input type="number" class="form-input" id="m-hourly_rate" min="0" step="0.5"></div>
      <div class="form-group"><label class="form-label">入职日期</label><input type="date" class="form-input" id="m-join_date"></div>`;
    App.openModal('添加员工', body, async () => {
      let position = document.getElementById('m-position').value;
      const customPos = document.getElementById('m-positionCustom').value.trim();
      if (position === '其他' && customPos) position = customPos;
      const data = {
        name: document.getElementById('m-name').value.trim(),
        position,
        hourly_rate: parseFloat(document.getElementById('m-hourly_rate').value),
        join_date: document.getElementById('m-join_date').value
      };
      if (!data.name) return App.toast('姓名必填', 'error');
      if (!data.hourly_rate || data.hourly_rate <= 0) return App.toast('时薪必须大于 0', 'error');
      await API.post('/employees', data);
      await Storage.refreshCache();
      renderTable();
      App.closeModal();
      App.toast('员工已添加', 'success');
    });
    // 切换自定义输入框显示
    document.getElementById('m-position').addEventListener('change', (e) => {
      document.getElementById('m-positionCustom').style.display = e.target.value === '其他' ? 'block' : 'none';
    });
  }

  function openEditModal(id) {
    const employees = Storage.getEmployeesSync();
    const emp = employees.find(e => e.id === id);
    if (!emp) return App.toast('员工不存在', 'error');
    const isPreset = POSITION_PRESETS.includes(emp.position);
    const body = `
      <div class="form-group"><label class="form-label">员工姓名 <span class="req">*</span></label><input type="text" class="form-input" id="m-name" value="${emp.name}"></div>
      <div class="form-group"><label class="form-label">岗位</label>
        <select class="form-select" id="m-position">
          ${POSITION_PRESETS.map(p => `<option value="${p}" ${(isPreset && emp.position === p) ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <input type="text" class="form-input" id="m-positionCustom" placeholder="或输入自定义岗位..." value="${!isPreset ? emp.position : ''}" style="margin-top:4px;${isPreset ? 'display:none;' : 'display:block;'}">
      </div>
      <div class="form-group"><label class="form-label">时薪（¥/小时，按人民币录入）<span class="req">*</span></label><input type="number" class="form-input" id="m-hourly_rate" min="0" step="0.5" value="${emp.hourly_rate}"></div>
      <div class="form-group"><label class="form-label">入职日期</label><input type="date" class="form-input" id="m-join_date" value="${emp.join_date || ''}"></div>`;
    App.openModal('编辑员工', body, async () => {
      let position = document.getElementById('m-position').value;
      const customPos = document.getElementById('m-positionCustom').value.trim();
      if (position === '其他' && customPos) position = customPos;
      const data = {
        name: document.getElementById('m-name').value.trim(),
        position,
        hourly_rate: parseFloat(document.getElementById('m-hourly_rate').value),
        join_date: document.getElementById('m-join_date').value
      };
      if (!data.name) return App.toast('姓名必填', 'error');
      if (!data.hourly_rate || data.hourly_rate <= 0) return App.toast('时薪必须大于 0', 'error');
      try {
        await API.put('/employees/' + id, data);
        await Storage.refreshCache();
        renderTable();
        App.closeModal();
        App.toast('员工信息已更新', 'success');
        if (App.currentPage === 'dashboard') Dashboard.render();
      } catch (e) { App.toast(e.message, 'error'); }
    });
    // 切换自定义输入框显示
    document.getElementById('m-position').addEventListener('change', (e) => {
      const customInput = document.getElementById('m-positionCustom');
      customInput.style.display = e.target.value === '其他' ? 'block' : 'none';
      if (e.target.value !== '其他') customInput.value = '';
    });
  }

  async function del(id) {
    if (!confirm('确认删除该员工？关联工时将一并删除。')) return;
    await API.del('/employees/' + id);
    await Storage.refreshCache();
    renderTable();
    App.toast('已删除', 'success');
  }

  function bind() {
    document.getElementById('empMonth').addEventListener('change', (e) => {
      selectedMonth = e.target.value;
      renderTable();
    });
  }

  return { render, bind, openModal, openEditModal, del };
})();
