/**
 * employees.js — 员工模块
 * 三个子页面：
 *   1. 员工信息（emp-roster）：员工档案维护，状态/岗位/时薪/入职日期；排序在职在前；姓名 combobox 模糊匹配 + 重复校验。
 *   2. 员工入离职记录（emp-history）：展示每位员工每次 入职/离职/复职 的状态变更（数据来自 employee_status_history）。
 *   3. 工时与工资（emp-hours）：按查询年月反查员工当时状态/岗位/时薪；离职且当月无变更不显示不计合计；当月有变更则红字提示。
 */
const Employees = (() => {
  let selectedMonth = '';
  let rosterFilter = { name: '', status: 'all' };
  let histFilter = { createdAt: '', date: '', empId: '', name: '', changeType: '', position: '' };
  let hoursFilter = { name: '' };
  let currentRosterRows = [];
  let currentHistRows = [];
  let currentEmpRows = [];

  const POSITION_PRESETS = ['管理员', '裁剪工', '缝纫工', '包装工', '质检员', '库管员', '设计师', '其他'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ========================================================================
  // 工具：按查询年月反查员工「当时」的状态/岗位/时薪
  // ========================================================================
  function monthEnd(month) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m, 0);
    return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 返回某员工在指定年月「月末」的快照，以及当月是否发生过状态变更
  function getEmployeeStatusAtMonth(emp, month) {
    const histories = (Storage.getEmployeeStatusHistorySync(emp.id) || []).slice()
      .sort((a, b) => (a.changed_date < b.changed_date ? -1 : a.changed_date > b.changed_date ? 1 : a.id - b.id));
    const end = monthEnd(month);
    const start = month + '-01';
    let latest = null;
    let changeThisMonth = false;
    for (const h of histories) {
      if (h.changed_date <= end) latest = h;
      if (h.changed_date >= start && h.changed_date <= end) changeThisMonth = true;
    }
    if (!latest) {
      return { status: emp.status || 'active', position: emp.position || '', hourly_rate: emp.hourly_rate || 0, changeType: '', changeThisMonth: false, hasHistory: false };
    }
    return {
      status: latest.status,
      changeType: latest.change_type || (latest.status === 'active' ? '入职' : '离职'),
      position: latest.position || '',
      hourly_rate: latest.hourly_rate || 0,
      changeThisMonth,
      hasHistory: true
    };
  }

  // 从状态变更历史推算离职区间（最近一次离职日期用于「自 X 起离职」提示）
  function getLeavePeriods(emp) {
    const histories = (Storage.getEmployeeStatusHistorySync && Storage.getEmployeeStatusHistorySync(emp.id)) || [];
    const periods = [];
    let cur = null;
    for (const h of histories) {
      if (h.status === 'left') {
        if (!cur) { cur = { start: h.changed_date, end: null }; periods.push(cur); }
      } else if (h.status === 'active' && cur) {
        cur.end = h.changed_date;
        cur = null;
      }
    }
    return periods;
  }
  function getLeaveHint(emp) {
    const isLeft = (emp.status || 'active') === 'left';
    const periods = getLeavePeriods(emp);
    if (isLeft && periods.length) {
      const p = periods[periods.length - 1];
      return `自 ${p.start} 起离职`;
    }
    if (!isLeft && periods.length) {
      const descs = periods.map(p => p.end ? `${p.start} ~ ${p.end}` : p.start).join('、');
      return `曾离职：${descs}`;
    }
    return '';
  }

  // 获取某员工最近一条状态变更历史
  function getEmployeeLatestHistory(emp) {
    const histories = (Storage.getEmployeeStatusHistorySync(emp.id) || []).slice()
      .sort((a, b) => (a.changed_date < b.changed_date ? -1 : a.changed_date > b.changed_date ? 1 : a.id - b.id));
    return histories.length ? histories[histories.length - 1] : null;
  }

  // 按入离职历史判断员工当前是否在职（change_type=入职/复职 视为在职，离职 视为离职；无历史则回退 employees.status）
  function isEmployeeActiveByHistory(emp) {
    const h = getEmployeeLatestHistory(emp);
    if (!h) return (emp.status || 'active') === 'active';
    const ct = h.change_type || (h.status === 'active' ? '入职' : '离职');
    return ct === '入职' || ct === '复职';
  }

  // 获取最近一条入职/复职状态变更历史（用于取岗位/时薪/入职日期）
  function getLastActiveHistory(emp) {
    const histories = (Storage.getEmployeeStatusHistorySync(emp.id) || []).slice()
      .sort((a, b) => (a.changed_date < b.changed_date ? -1 : a.changed_date > b.changed_date ? 1 : a.id - b.id));
    for (let i = histories.length - 1; i >= 0; i--) {
      const ct = histories[i].change_type || (histories[i].status === 'active' ? '入职' : '离职');
      if (ct === '入职' || ct === '复职') return histories[i];
    }
    return null;
  }

  // 获取最近一条离职状态变更历史（用于复职日期范围限制）
  function getLastLeaveHistory(emp) {
    const histories = (Storage.getEmployeeStatusHistorySync(emp.id) || []).slice()
      .sort((a, b) => (a.changed_date < b.changed_date ? -1 : a.changed_date > b.changed_date ? 1 : a.id - b.id));
    for (let i = histories.length - 1; i >= 0; i--) {
      const ct = histories[i].change_type || (histories[i].status === 'active' ? '入职' : '离职');
      if (ct === '离职') return histories[i];
    }
    return null;
  }

  function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // 获取最近一条入职或复职的日期（无历史则回退 join_date）
  function getLastOnboardDate(emp) {
    const h = getLastActiveHistory(emp);
    return h ? h.changed_date : (emp.join_date || '');
  }

  // ========================================================================
  // 一、员工信息（原员工档案）
  // ========================================================================
  function renderRoster() {
    const all = Storage.getEmployeesSync();
    const inCount = all.filter(e => isEmployeeActiveByHistory(e)).length;
    const leftCount = all.length - inCount;
    let employees = all.slice();
    if (rosterFilter.status && rosterFilter.status !== 'all') {
      employees = employees.filter(e => (rosterFilter.status === 'active') === isEmployeeActiveByHistory(e));
    }
    if (rosterFilter.name) {
      const kw = rosterFilter.name.toLowerCase();
      employees = employees.filter(e => (e.name || '').toLowerCase().includes(kw));
    }
    // 排序：在职在前，离职在后；同状态按 id 升序
    employees.sort((a, b) => {
      const ra = isEmployeeActiveByHistory(a) ? 0 : 1;
      const rb = isEmployeeActiveByHistory(b) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.id - b.id;
    });
    currentRosterRows = employees.slice();

    const countEl = document.getElementById('rosterCount');
    if (countEl) countEl.textContent = inCount;
    const leftCountEl = document.getElementById('rosterLeftCount');
    if (leftCountEl) leftCountEl.textContent = leftCount;

    const tbl = document.getElementById('rosterTable');
    if (!tbl) return;
    if (employees.length === 0) {
      tbl.innerHTML = '<tr><td colspan="7" class="empty-state">暂无员工，点击右上角「+ 添加员工」建档</td></tr>';
      return;
    }
    const canEdit = Auth.canEdit();
    tbl.innerHTML = `<thead><tr><th>ID</th><th>姓名</th><th>岗位</th><th>时薪</th><th>入职/最近复职日期</th><th>当前状态</th><th>操作</th></tr></thead>
      <tbody>${employees.map(emp => {
        const isActive = isEmployeeActiveByHistory(emp);
        const activeHist = getLastActiveHistory(emp);
        const position = activeHist ? (activeHist.position || '') : (emp.position || '');
        const hourlyRate = activeHist ? (activeHist.hourly_rate || 0) : (emp.hourly_rate || 0);
        const statusTag = isActive ? '<span class="status-tag status-active">在职</span>' : '<span class="status-tag status-dim">离职</span>';
        const btnText = isActive ? '编辑' : '复职';
        const action = canEdit
          ? `<button class="btn btn-secondary btn-sm" onclick="Employees.openEditModal(${emp.id})">${btnText}</button>`
          : '—';
        return `<tr>
          <td>${emp.id}</td>
          <td>${esc(emp.name)}</td>
          <td>${esc(position) || '—'}</td>
          <td>${Calculator.fmtMoney(hourlyRate)}</td>
          <td>${esc(getLastOnboardDate(emp)) || '—'}</td>
          <td>${statusTag}</td>
          <td>${action}</td>
        </tr>`;
      }).join('')}</tbody>`;
  }

  // ========================================================================
  // 二、员工入离职记录
  // ========================================================================
  function renderHistory() {
    const all = Storage.getEmployeeStatusHistorySync();           // 全账号状态变更
    const empMap = {};
    Storage.getEmployeesSync().forEach(e => { empMap[e.id] = e; });
    let rows = all.map(h => ({
      id: h.id,
      createdAt: h.created_at ? h.created_at.slice(0, 19).replace('T', ' ') : '',
      date: h.changed_date,
      empId: h.employee_id,
      name: (empMap[h.employee_id] && empMap[h.employee_id].name) || '(已删除)',
      changeType: h.change_type || (h.status === 'active' ? '入职' : '离职'),
      position: h.position || '',
      hourly_rate: h.hourly_rate || 0
    }));
    // 筛选
    if (histFilter.createdAt) {
      const filterVal = histFilter.createdAt.trim().replace('T', ' ');
      rows = rows.filter(r => r.createdAt.includes(filterVal));
    }
    if (histFilter.date) rows = rows.filter(r => r.date === histFilter.date);
    if (histFilter.empId) rows = rows.filter(r => String(r.empId).includes(histFilter.empId.trim()));
    if (histFilter.name) {
      const kw = histFilter.name.toLowerCase();
      rows = rows.filter(r => (r.name || '').toLowerCase().includes(kw));
    }
    if (histFilter.changeType) rows = rows.filter(r => r.changeType === histFilter.changeType);
    if (histFilter.position) {
      const kw = histFilter.position.toLowerCase();
      rows = rows.filter(r => (r.position || '').toLowerCase().includes(kw));
    }
    // 默认按操作时间倒序（最新在前）
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id));
    currentHistRows = rows.slice();

    const tbl = document.getElementById('histTable');
    if (!tbl) return;
    if (rows.length === 0) {
      tbl.innerHTML = '<tr><td colspan="7" class="empty-state">暂无入离职记录</td></tr>';
      return;
    }
    const tagClass = (ct) => ct === '入职' ? 'status-onboard' : ct === '复职' ? 'status-reinstate' : 'status-dim';
    tbl.innerHTML = `<thead><tr><th>操作时间</th><th>员工ID</th><th>员工姓名</th><th>状态变更</th><th>变更登记日期</th><th>岗位</th><th>时薪</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${esc(r.createdAt)}</td>
        <td>${r.empId}</td>
        <td>${esc(r.name)}</td>
        <td><span class="status-tag ${tagClass(r.changeType)}">${esc(r.changeType)}</span></td>
        <td>${esc(r.date)}</td>
        <td>${esc(r.position) || '—'}</td>
        <td>${r.hourly_rate ? Calculator.fmtMoney(r.hourly_rate) : '—'}</td>
      </tr>`).join('')}</tbody>`;
  }

  // ========================================================================
  // 三、工时与工资（按查询年月展示当时状态）
  // ========================================================================
  function renderHours() {
    renderYearMonthSelectors();
    renderHoursTable();
  }

  function renderYearMonthSelectors() {
    const now = new Date();
    const curYear = now.getFullYear();
    if (!selectedMonth) selectedMonth = Calculator.currentMonth();
    const [defYear, defMonth] = selectedMonth.split('-');
    const yearSel = document.getElementById('empYear');
    if (!yearSel) return;
    const years = [];
    for (let y = curYear; y >= 2020; y--) years.push(y);
    yearSel.innerHTML = years.map(yr =>
      `<option value="${yr}" ${String(yr) === defYear ? 'selected' : ''}>${yr}年</option>`).join('');
    const monthSel = document.getElementById('empMonth');
    monthSel.innerHTML = Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, '0');
      return `<option value="${mm}" ${mm === defMonth ? 'selected' : ''}>${i + 1}月</option>`;
    }).join('');
  }

  // 计算当前查询条件下应展示的工时行（含 as-of-month 快照）
  function computeHoursRows() {
    let employees = Storage.getEmployeesSync();
    if (hoursFilter.name) {
      const kw = hoursFilter.name.toLowerCase();
      employees = employees.filter(e => (e.name || '').toLowerCase().includes(kw));
    }
    const workHours = Storage.getWorkHoursSync(selectedMonth);
    const rows = [];
    for (const emp of employees) {
      const snap = getEmployeeStatusAtMonth(emp, selectedMonth);
      const isActive = snap.status === 'active';
      // 仅展示「在岗」或「当月发生过状态变更」的员工（离职且当月无变更不显示、不计合计）
      if (!isActive && !snap.changeThisMonth) continue;
      const wh = workHours.find(w => w.employee_id === emp.id);
      const hours = wh ? wh.hours : 0;
      const rate = snap.hourly_rate || 0;
      rows.push({ emp, snap, hours, rate, salary: hours * rate, whId: wh ? wh.id : null });
    }
    // 排序：在职在前，离职在后；同状态按 id 升序
    rows.sort((a, b) => {
      const ra = a.snap.status === 'active' ? 0 : 1;
      const rb = b.snap.status === 'active' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.emp.id - b.emp.id;
    });
    return rows;
  }

  function renderHoursTable() {
    const rows = computeHoursRows();
    currentEmpRows = rows.map(r => r.emp);
    let totalHours = 0, totalSalary = 0;
    rows.forEach(r => { totalHours += r.hours; totalSalary += r.salary; });

    document.getElementById('empCount').textContent = rows.length;
    document.getElementById('empTotalHours').textContent = Calculator.fmtHour(totalHours);
    document.getElementById('empTotalSalary').textContent = Calculator.fmtMoney(totalSalary);

    const tbl = document.getElementById('empTable');
    if (rows.length === 0) {
      tbl.innerHTML = '<tr><td colspan="6" class="empty-state">该查询年月下没有可统计的员工</td></tr>';
      return;
    }
    const canEdit = Auth.canEdit();
    const tagClass = (snap) => {
      if (snap.status !== 'active') return 'status-dim';
      return snap.changeType === '复职' ? 'status-reinstate' : 'status-onboard';
    };
    tbl.innerHTML = `<thead><tr><th>姓名</th><th>岗位</th><th>时薪</th><th>状态</th><th>月工时</th><th>月工资</th></tr></thead>
      <tbody>${rows.map(r => {
        const isLeft = r.snap.status !== 'active';
        const statusLabel = isLeft ? '离职' : (r.snap.changeType || '入职');
        const position = r.snap.position ? esc(r.snap.position) : (isLeft ? '—' : '—');
        const rateTxt = r.rate ? Calculator.fmtMoney(r.rate) : '—';
        const salaryTxt = (isLeft || !r.rate) ? '—' : Calculator.fmtMoney(r.salary);
        const hoursCell = canEdit
          ? `<input type="number" class="form-input emp-hours-input" style="width:90px;text-align:center;" value="${r.hours}" min="0" step="0.5" data-emp="${r.emp.id}" data-month="${selectedMonth}">`
          : (r.hours + ' h');
        const hint = r.snap.changeThisMonth
          ? `<div class="month-change-hint">该员工当月内办理了入职/离职/复职，请考勤人员确认实际出勤工时并填写</div>` : '';
        return `<tr>
          <td>${esc(r.emp.name)}</td>
          <td>${position}</td>
          <td>${rateTxt}</td>
          <td><span class="status-tag ${tagClass(r.snap)}">${esc(statusLabel)}</span></td>
          <td>${hoursCell}${hint}</td>
          <td class="amt pos">${salaryTxt}</td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td colspan="4">合计</td><td>${Calculator.fmtHour(totalHours)}</td><td class="amt pos">${Calculator.fmtMoney(totalSalary)}</td></tr></tfoot>`;

    if (canEdit) {
      document.querySelectorAll('.emp-hours-input').forEach(input => {
        input.addEventListener('change', async (e) => {
          const empId = Number(e.target.dataset.emp);
          const month = e.target.dataset.month;
          const hours = parseFloat(e.target.value) || 0;
          try {
            await API.post('/workhours', { employee_id: empId, hours, month });
            await Storage.refreshCache();
            renderHoursTable();
            if (App.currentPage === 'dashboard') Dashboard.render();
          } catch (err) { App.toast('保存失败：' + err.message, 'error'); }
        });
      });
    }
  }

  // ========================================================================
  // 四、添加员工（姓名 combobox 模糊匹配 + 三态重复校验）
  // ========================================================================
  function openModal() {
    const body = `
      <div class="form-group"><label class="form-label">员工姓名 <span class="req">*</span></label>
        <div class="combobox" id="m-name-box">
          <input type="text" class="form-input cb-input" id="m-name" autocomplete="off" placeholder="输入或选择已有员工">
          <div class="cb-panel" id="m-name-panel"></div>
        </div>
      </div>
      <div class="form-group"><label class="form-label">岗位</label>
        <select class="form-select" id="m-position">
          ${POSITION_PRESETS.map(p => `<option value="${p}">${p}</option>`).join('')}
        </select>
        <input type="text" class="form-input" id="m-positionCustom" placeholder="或输入自定义岗位..." style="margin-top:4px;display:none;">
      </div>
      <div class="form-group"><label class="form-label">时薪（¥/小时，按人民币录入）<span class="req">*</span></label><input type="number" class="form-input" id="m-hourly_rate" min="0" step="0.5"></div>
      <div class="form-group"><label class="form-label">入职日期</label><input type="date" class="form-input" id="m-join_date"></div>`;
    App.openModal('添加员工', body, async () => { await submitAdd(); });
    bindNameCombobox();
    bindPositionCustom('m-position', 'm-positionCustom');
  }

  function bindNameCombobox() {
    const input = document.getElementById('m-name');
    const panel = document.getElementById('m-name-panel');
    if (!input || !panel) return;
    const render = () => {
      const kw = input.value.trim().toLowerCase();
      const emps = Storage.getEmployeesSync();
      const matches = (kw ? emps.filter(e => (e.name || '').toLowerCase().includes(kw)) : emps).slice(0, 8);
      if (matches.length === 0) { panel.classList.remove('open'); panel.innerHTML = ''; return; }
      panel.innerHTML = matches.map(e => `<div class="cb-option" data-name="${esc(e.name)}">${esc(e.name)}</div>`).join('');
      panel.classList.add('open');
      panel.querySelectorAll('.cb-option').forEach(opt => {
        opt.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          input.value = opt.dataset.name;
          panel.classList.remove('open');
        });
      });
    };
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('blur', () => setTimeout(() => panel.classList.remove('open'), 150));
  }

  async function submitAdd() {
    const name = document.getElementById('m-name').value.trim();
    if (!name) return App.toast('姓名必填', 'error');
    let position = document.getElementById('m-position').value;
    const customPos = document.getElementById('m-positionCustom').value.trim();
    if (position === '其他' && customPos) position = customPos;
    const hourly = parseFloat(document.getElementById('m-hourly_rate').value);
    if (!hourly || hourly <= 0) return App.toast('时薪必须大于 0', 'error');
    const join_date = document.getElementById('m-join_date').value;

    const matched = Storage.getEmployeesSync().find(e => e.name === name);
    if (!matched) {
      await API.post('/employees', { name, position, hourly_rate: hourly, join_date });
      await Storage.refreshCache();
      renderRoster();
      App.closeModal();
      App.toast('员工已添加', 'success');
      return;
    }
    if ((matched.status || 'active') === 'active') {
      alert(`该员工姓名已被录入过系统，ID为${matched.id}，请勿重复录入！`);
      return;
    }
    // 已录入且当前离职：提交后复职 + 更新信息
    if (confirm(`该员工姓名已被录入过系统，ID为${matched.id}，提交后会将该员工状态改为"在职"，岗位、时薪、入职/最近复职日期也按照本次提交结果进行更新！`)) {
      await API.put('/employees/' + matched.id, { name, position, hourly_rate: hourly, join_date });
      await API.patch('/employees/' + matched.id + '/status', { status: 'active', position, hourly_rate: hourly, changed_date: join_date });
      await Storage.refreshCache();
      renderRoster();
      App.closeModal();
      App.toast('已复职并更新员工信息', 'success');
    }
  }

  // ========================================================================
  // 五、编辑员工（在职→编辑 / 离职→复职）
  // ========================================================================
  function openEditModal(id) {
    const emp = Storage.getEmployeesSync().find(e => e.id === id);
    if (!emp) return App.toast('员工不存在', 'error');
    const activeHist = getLastActiveHistory(emp);
    const currentPosition = activeHist ? (activeHist.position || '') : (emp.position || '');
    const currentRate = activeHist ? (activeHist.hourly_rate || 0) : (emp.hourly_rate || 0);
    const isPreset = POSITION_PRESETS.includes(currentPosition);
    const isLeft = !isEmployeeActiveByHistory(emp);
    const title = isLeft ? '员工复职' : '编辑员工';
    const today = new Date().toISOString().slice(0, 10);

    let extraFields = '';
    if (isLeft) {
      const lastLeave = getLastLeaveHistory(emp);
      const minDate = lastLeave ? addDays(lastLeave.changed_date, 1) : today;
      const defaultDate = minDate > today ? minDate : today;
      extraFields = `
        <div class="form-group"><label class="form-label">复职登记日期 <span class="req">*</span></label><input type="date" class="form-input" id="m-reinstate_date" min="${minDate}" value="${defaultDate}"></div>`;
    } else {
      extraFields = `
        <div class="form-group" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="m-leave_chk" style="width:auto;">
          <label for="m-leave_chk" style="margin:0;">变更为离职</label>
        </div>
        <div class="form-group" id="m-leave_date_group" style="display:none;">
          <label class="form-label">离职登记日期 <span class="req">*</span></label>
          <input type="date" class="form-input" id="m-leave_date" value="${today}">
        </div>`;
    }

    const body = `
      <div class="form-group"><label class="form-label">员工姓名 <span class="req">*</span></label><input type="text" class="form-input" id="m-name" value="${esc(emp.name)}"></div>
      <div class="form-group"><label class="form-label">岗位</label>
        <select class="form-select" id="m-position">
          ${POSITION_PRESETS.map(p => `<option value="${p}" ${(isPreset && currentPosition === p) ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <input type="text" class="form-input" id="m-positionCustom" placeholder="或输入自定义岗位..." value="${!isPreset ? esc(currentPosition) : ''}" style="margin-top:4px;${isPreset ? 'display:none;' : 'display:block;'}">
      </div>
      <div class="form-group"><label class="form-label">时薪（¥/小时，按人民币录入）<span class="req">*</span></label><input type="number" class="form-input" id="m-hourly_rate" min="0" step="0.5" value="${currentRate}"></div>
      ${extraFields}`;
    App.openModal(title, body, async () => {
      let position = document.getElementById('m-position').value;
      const customPos = document.getElementById('m-positionCustom').value.trim();
      if (position === '其他' && customPos) position = customPos;
      const data = {
        name: document.getElementById('m-name').value.trim(),
        position,
        hourly_rate: parseFloat(document.getElementById('m-hourly_rate').value)
      };
      if (!data.name) return App.toast('姓名必填', 'error');
      if (!data.hourly_rate || data.hourly_rate <= 0) return App.toast('时薪必须大于 0', 'error');
      try {
        await API.put('/employees/' + id, data);
        if (isLeft) {
          const reinstateDate = document.getElementById('m-reinstate_date').value;
          if (!reinstateDate) return App.toast('复职登记日期必填', 'error');
          await API.patch('/employees/' + id + '/status', { status: 'active', position, hourly_rate: data.hourly_rate, changed_date: reinstateDate });
        } else {
          const leaveChk = document.getElementById('m-leave_chk');
          if (leaveChk && leaveChk.checked) {
            const leaveDate = document.getElementById('m-leave_date').value;
            if (!leaveDate) return App.toast('离职登记日期必填', 'error');
            await API.patch('/employees/' + id + '/status', { status: 'left', position, hourly_rate: data.hourly_rate, changed_date: leaveDate });
          }
        }
        await Storage.refreshCache();
        renderRoster();
        App.closeModal();
        App.toast('员工信息已更新', 'success');
        if (App.currentPage === 'dashboard') Dashboard.render();
      } catch (e) { App.toast(e.message, 'error'); }
    });
    bindPositionCustom('m-position', 'm-positionCustom');
    if (!isLeft) {
      const chk = document.getElementById('m-leave_chk');
      const group = document.getElementById('m-leave_date_group');
      if (chk && group) {
        chk.addEventListener('change', (e) => {
          group.style.display = e.target.checked ? 'block' : 'none';
        });
      }
    }
  }

  function bindPositionCustom(selId, customId) {
    const sel = document.getElementById(selId);
    const custom = document.getElementById(customId);
    if (!sel || !custom) return;
    sel.addEventListener('change', (e) => {
      custom.style.display = e.target.value === '其他' ? 'block' : 'none';
      if (e.target.value !== '其他') custom.value = '';
    });
  }

  // ========================================================================
  // 六、筛选重置 & 事件绑定
  // ========================================================================
  function resetRosterFilters() {
    rosterFilter = { name: '', status: 'all' };
    const el = document.getElementById('rosterQName'); if (el) el.value = '';
    document.querySelectorAll('.roster-status-seg').forEach(b => b.classList.toggle('active', (b.dataset.status || 'all') === 'all'));
    renderRoster();
  }
  function resetHoursFilters() {
    hoursFilter = { name: '' };
    const el = document.getElementById('empQName'); if (el) el.value = '';
    renderHoursTable();
  }
  function resetHistFilters() {
    histFilter = { createdAt: '', date: '', empId: '', name: '', changeType: '', position: '' };
    ['histCreatedAt', 'histDate', 'histEmpId', 'histName', 'histPosition'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const sel = document.getElementById('histChangeType'); if (sel) sel.value = '';
    renderHistory();
  }

  function bind() {
    // 工时与工资：年月选择
    const yearSel = document.getElementById('empYear');
    const monthSel = document.getElementById('empMonth');
    if (yearSel && monthSel) {
      const sync = () => { selectedMonth = `${yearSel.value}-${monthSel.value}`; renderHoursTable(); };
      yearSel.addEventListener('change', sync);
      monthSel.addEventListener('change', sync);
    }
    // 工时与工资：姓名筛选 + 重置
    const empQ = document.getElementById('empQName');
    if (empQ) empQ.addEventListener('input', () => { hoursFilter.name = empQ.value.trim(); renderHoursTable(); });
    const empReset = document.getElementById('empResetBtn');
    if (empReset) empReset.addEventListener('click', resetHoursFilters);

    // 员工信息：姓名筛选 + 重置 + 状态段
    const rosterQ = document.getElementById('rosterQName');
    if (rosterQ) rosterQ.addEventListener('input', () => { rosterFilter.name = rosterQ.value.trim(); renderRoster(); });
    const rosterReset = document.getElementById('rosterResetBtn');
    if (rosterReset) rosterReset.addEventListener('click', resetRosterFilters);
    document.querySelectorAll('.roster-status-seg').forEach(btn => {
      btn.addEventListener('click', () => {
        rosterFilter.status = btn.dataset.status || 'all';
        document.querySelectorAll('.roster-status-seg').forEach(b => b.classList.toggle('active', b === btn));
        renderRoster();
      });
    });

    // 员工入离职记录：筛选 + 重置
    const bindHist = (id, key, isSelect) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => { histFilter[key] = el.value.trim(); renderHistory(); });
      if (isSelect) el.addEventListener('change', () => { histFilter[key] = el.value; renderHistory(); });
    };
    bindHist('histCreatedAt', 'createdAt', false);
    bindHist('histDate', 'date', false);
    bindHist('histEmpId', 'empId', false);
    bindHist('histName', 'name', false);
    bindHist('histChangeType', 'changeType', true);
    bindHist('histPosition', 'position', false);
    const histReset = document.getElementById('histResetBtn');
    if (histReset) histReset.addEventListener('click', resetHistFilters);
  }

  // ========================================================================
  // 七、导出
  // ========================================================================
  function getRosterExportRows() {
    return currentRosterRows.map(emp => ({
      name: emp.name, position: emp.position || '',
      hourly_rate: emp.hourly_rate, currency: Calculator.getCurrency(),
      join_date: getLastOnboardDate(emp) || '',
      status: isEmployeeActiveByHistory(emp) ? '在职' : '离职'
    }));
  }

  function getExportRows() {
    const rows = computeHoursRows();
    const workHours = Storage.getWorkHoursSync(selectedMonth);
    return rows.map(r => {
      const wh = workHours.find(w => w.employee_id === r.emp.id);
      return {
        name: r.emp.name, position: r.snap.position || '',
        hourly_rate: r.rate, currency: Calculator.getCurrency(),
        month: selectedMonth, hours: r.hours, salary: Math.round(r.salary),
        join_date: r.emp.join_date || '',
        status: r.snap.status === 'active' ? (r.snap.changeType || '入职') : '离职'
      };
    });
  }

  return {
    renderRoster, renderHistory, renderHours, bind,
    openModal, openEditModal,
    getRosterExportRows, getExportRows
  };
})();
