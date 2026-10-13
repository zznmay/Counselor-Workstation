// 默认辅导员名单
const DEFAULT_COUNSELORS = [
    '周振南', '张瀚文', '张婧蕾', '孙五九',
    '卢雨颖', '张玲', '包骅瑛', '唐溪琴'
];

// 数据存储
let counselors = [];
let holidays = [];
let restrictions = {};
let multiDuties = []; // 多人值班设置
let maxDutyLimits = {}; // 辅导员最大值班天数限制
let mentorshipSettings = []; // 老带新值班设置

// 当前编辑的限制设置
let currentRestrictions = {
    weekdays: [],
    dates: [],
    periods: []
};

// 星期名称
const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    initData();
    initTabs();
    renderCounselors();
    renderHolidays();
    renderMultiDuties();
    renderMaxDutyLimits();
    renderRestrictionSummary();
    renderMentorshipSettings();
    updateCounselorSelects();
    initDefaultDates();

    // 监听新人选择变化，更新搭档列表
    const newbieSelect = document.getElementById('mentorshipNewbie');
    if (newbieSelect) {
        newbieSelect.addEventListener('change', updateMentorshipPartnerList);
    }

    // 多人协同：登录后从服务端拉取共享数据，覆盖本地缓存并刷新界面
    loadFromServer();
});

// 初始化数据（localStorage 作离线缓存；登录后与服务端共享数据同步）
function initData() {
    // 从localStorage加载数据
    const savedCounselors = localStorage.getItem('cs_counselors');
    const savedHolidays = localStorage.getItem('cs_holidays');
    const savedRestrictions = localStorage.getItem('cs_restrictions');
    const savedMultiDuties = localStorage.getItem('cs_multiDuties');
    const savedMaxDutyLimits = localStorage.getItem('cs_maxDutyLimits');
    const savedMentorshipSettings = localStorage.getItem('cs_mentorshipSettings');
    
    // 如果有保存的辅导员数据，使用保存的；否则使用默认名单
    if (savedCounselors) {
        counselors = JSON.parse(savedCounselors);
    } else {
        // 首次使用，创建默认辅导员名单
        counselors = DEFAULT_COUNSELORS.map((name, index) => ({
            id: Date.now() + index,
            name: name,
            active: true
        }));
        saveData();
    }
    
    holidays = savedHolidays ? JSON.parse(savedHolidays) : [];
    restrictions = savedRestrictions ? JSON.parse(savedRestrictions) : {};
    multiDuties = savedMultiDuties ? JSON.parse(savedMultiDuties) : [];
    maxDutyLimits = savedMaxDutyLimits ? JSON.parse(savedMaxDutyLimits) : {};
    mentorshipSettings = savedMentorshipSettings ? JSON.parse(savedMentorshipSettings) : [];
}

// ---------- 服务端同步（多教师共享同一份排班数据） ----------
function authHeaders() {
    var token = null;
    try { token = localStorage.getItem('workbench_token'); } catch (e) { /* ignore */ }
    return token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                 : { 'Content-Type': 'application/json' };
}

function applyServerData(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.counselors) && data.counselors.length > 0) counselors = data.counselors;
    if (Array.isArray(data.holidays)) holidays = data.holidays;
    if (data.restrictions && typeof data.restrictions === 'object') restrictions = data.restrictions;
    if (Array.isArray(data.multiDuties)) multiDuties = data.multiDuties;
    if (data.maxDutyLimits && typeof data.maxDutyLimits === 'object') maxDutyLimits = data.maxDutyLimits;
    if (Array.isArray(data.mentorshipSettings)) mentorshipSettings = data.mentorshipSettings;

    // 覆盖本地缓存并刷新界面
    saveLocal();
    renderCounselors();
    renderHolidays();
    renderMultiDuties();
    renderMaxDutyLimits();
    renderRestrictionSummary();
    renderMentorshipSettings();
    updateCounselorSelects();
}

function loadFromServer() {
    var token = null;
    try { token = localStorage.getItem('workbench_token'); } catch (e) { /* ignore */ }
    if (!token) return; // 未登录（直接打开工具页）时保持本地模式
    fetch('/api/scheduler', { headers: authHeaders() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (res) {
            if (res && res.data && Object.keys(res.data).length > 0) {
                applyServerData(res.data);
            }
        })
        .catch(function () { /* 网络异常时静默使用本地缓存 */ });
}

function pushToServer() {
    var token = null;
    try { token = localStorage.getItem('workbench_token'); } catch (e) { /* ignore */ }
    if (!token) return;
    fetch('/api/scheduler', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ data: collectData() })
    }).catch(function () { /* 失败时本地缓存仍在，下次保存会重试 */ });
}

function saveLocal() {
    localStorage.setItem('cs_counselors', JSON.stringify(counselors));
    localStorage.setItem('cs_holidays', JSON.stringify(holidays));
    localStorage.setItem('cs_restrictions', JSON.stringify(restrictions));
    localStorage.setItem('cs_multiDuties', JSON.stringify(multiDuties));
    localStorage.setItem('cs_maxDutyLimits', JSON.stringify(maxDutyLimits));
    localStorage.setItem('cs_mentorshipSettings', JSON.stringify(mentorshipSettings));
}

function collectData() {
    return {
        counselors: counselors,
        holidays: holidays,
        restrictions: restrictions,
        multiDuties: multiDuties,
        maxDutyLimits: maxDutyLimits,
        mentorshipSettings: mentorshipSettings
    };
}

// 初始化默认日期
function initDefaultDates() {
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    
    document.getElementById('scheduleStartDate').value = formatDate(nextMonth);
    document.getElementById('scheduleEndDate').value = formatDate(nextMonthEnd);
    document.getElementById('holidayStartDate').value = formatDate(today);
    document.getElementById('holidayEndDate').value = formatDate(today);
    // 不可值班日期不设默认值
    document.getElementById('restrictedDate').value = '';
}

// 格式化日期
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

// 标签页切换
function initTabs() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            
            navBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(tabId).classList.add('active');
            
            // 切换到节假日页面时更新多选框
            if (tabId === 'holidays') {
                updateHolidayCounselorCheckboxes();
            }
            // 切换到规则页面时更新辅导员选择
            if (tabId === 'rules') {
                updateRestrictionCounselorSelect();
            }
        });
    });
}

// ==================== 辅导员管理 ====================

function resetDefaultCounselors() {
    if (!confirm('确定要恢复默认辅导员名单吗？当前名单将被替换。')) return;
    
    counselors = DEFAULT_COUNSELORS.map((name, index) => ({
        id: Date.now() + index,
        name: name,
        active: true
    }));
    
    // 清空限制设置
    restrictions = {};
    
    saveData();
    renderCounselors();
    updateCounselorSelects();
    alert('已恢复默认辅导员名单');
}

function addCounselor() {
    const nameInput = document.getElementById('counselorName');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('请输入辅导员姓名');
        return;
    }
    
    if (counselors.some(c => c.name === name)) {
        alert('该辅导员已存在');
        return;
    }
    
    counselors.push({
        id: Date.now(),
        name: name,
        active: true
    });
    
    saveData();
    nameInput.value = '';
    renderCounselors();
    updateCounselorSelects();
}

function renderCounselors() {
    const tbody = document.getElementById('counselorList');
    const emptyDiv = document.getElementById('emptyCounselors');
    const table = document.getElementById('counselorTable');
    
    if (counselors.length === 0) {
        tbody.innerHTML = '';
        emptyDiv.style.display = 'block';
        table.style.display = 'none';
        return;
    }
    
    emptyDiv.style.display = 'none';
    table.style.display = 'table';
    
    tbody.innerHTML = counselors.map((c, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${c.name}</td>
            <td>
                <label class="toggle-switch">
                    <input type="checkbox" ${c.active ? 'checked' : ''} onchange="toggleCounselor(${c.id})">
                    <span class="slider"></span>
                </label>
            </td>
            <td>
                <button class="btn-danger" onclick="deleteCounselor(${c.id})">删除</button>
            </td>
        </tr>
    `).join('');
}

function toggleCounselor(id) {
    const counselor = counselors.find(c => c.id === id);
    if (counselor) {
        counselor.active = !counselor.active;
        saveData();
        updateCounselorSelects();
    }
}

function deleteCounselor(id) {
    if (!confirm('确定要删除该辅导员吗？')) return;
    
    counselors = counselors.filter(c => c.id !== id);
    delete restrictions[id];
    
    // 删除相关的节假日安排
    holidays.forEach(h => {
        h.counselorIds = h.counselorIds.filter(cid => cid !== id);
    });
    
    saveData();
    renderCounselors();
    renderHolidays();
    updateCounselorSelects();
}

// ==================== 法定节假日管理 ====================

function addHoliday() {
    const startDateInput = document.getElementById('holidayStartDate');
    const endDateInput = document.getElementById('holidayEndDate');
    const nameInput = document.getElementById('holidayName');
    
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;
    const name = nameInput.value.trim();
    
    // 获取选中的辅导员
    const selectedCounselors = [];
    document.querySelectorAll('#holidayCounselorList input:checked').forEach(cb => {
        selectedCounselors.push(parseInt(cb.value));
    });
    
    if (!startDate || !endDate) {
        alert('请选择开始和结束日期');
        return;
    }
    
    if (startDate > endDate) {
        alert('开始日期不能晚于结束日期');
        return;
    }
    
    if (!name) {
        alert('请输入节日名称');
        return;
    }
    
    // 检查日期范围是否重叠
    const hasOverlap = holidays.some(h => {
        return (startDate <= h.endDate && endDate >= h.startDate);
    });
    
    if (hasOverlap) {
        alert('该日期范围与已有节假日重叠');
        return;
    }
    
    holidays.push({
        id: Date.now(),
        startDate: startDate,
        endDate: endDate,
        name: name,
        counselorIds: selectedCounselors
    });
    
    saveData();
    nameInput.value = '';
    // 清空多选框
    document.querySelectorAll('#holidayCounselorList input').forEach(cb => cb.checked = false);
    renderHolidays();
}

function renderHolidays() {
    const tbody = document.getElementById('holidayList');
    const emptyDiv = document.getElementById('emptyHolidays');
    const table = document.getElementById('holidayTable');
    
    // 按开始日期排序
    holidays.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    
    if (holidays.length === 0) {
        tbody.innerHTML = '';
        emptyDiv.style.display = 'block';
        table.style.display = 'none';
        return;
    }
    
    emptyDiv.style.display = 'none';
    table.style.display = 'table';
    
    tbody.innerHTML = holidays.map(h => {
        const dateRange = h.startDate === h.endDate 
            ? h.startDate 
            : `${h.startDate} 至 ${h.endDate}`;
        
        const counselorNames = h.counselorIds.length > 0
            ? h.counselorIds.map(id => counselors.find(c => c.id === id)?.name).filter(Boolean).join('、')
            : '系统分配';
        
        return `
            <tr>
                <td>${dateRange}</td>
                <td>${h.name}</td>
                <td>${counselorNames}</td>
                <td>
                    <button class="btn-danger" onclick="deleteHoliday(${h.id})">删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

function deleteHoliday(id) {
    if (!confirm('确定要删除该节假日设置吗？')) return;
    
    holidays = holidays.filter(h => h.id !== id);
    saveData();
    renderHolidays();
}

// ==================== 多人值班设置 ====================

function addMultiDuty() {
    const dateInput = document.getElementById('multiDutyDate');
    const countInput = document.getElementById('multiDutyCount');
    
    const date = dateInput.value;
    const count = parseInt(countInput.value);
    
    // 获取选中的辅导员
    const selectedCounselors = [];
    document.querySelectorAll('#multiDutyCounselorList input:checked').forEach(cb => {
        selectedCounselors.push(parseInt(cb.value));
    });
    
    if (!date) {
        alert('请选择值班日期');
        return;
    }
    
    if (selectedCounselors.length === 0) {
        alert('请至少选择一名值班人员');
        return;
    }
    
    if (selectedCounselors.length < count) {
        alert(`选中的值班人员数量(${selectedCounselors.length})少于要求的值班人数(${count})`);
        return;
    }
    
    // 检查是否已存在该日期的设置
    const existingIndex = multiDuties.findIndex(m => m.date === date);
    if (existingIndex >= 0) {
        if (!confirm('该日期已有多人值班设置，是否覆盖？')) return;
        multiDuties[existingIndex] = {
            id: Date.now(),
            date: date,
            count: count,
            counselorIds: selectedCounselors
        };
    } else {
        multiDuties.push({
            id: Date.now(),
            date: date,
            count: count,
            counselorIds: selectedCounselors
        });
    }
    
    // 按日期排序
    multiDuties.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    saveData();
    dateInput.value = '';
    countInput.value = '2';
    // 清空多选框
    document.querySelectorAll('#multiDutyCounselorList input').forEach(cb => cb.checked = false);
    renderMultiDuties();
}

function renderMultiDuties() {
    const tbody = document.getElementById('multiDutyList');
    const emptyDiv = document.getElementById('emptyMultiDuty');
    const table = document.getElementById('multiDutyTable');
    
    if (multiDuties.length === 0) {
        tbody.innerHTML = '';
        emptyDiv.style.display = 'block';
        table.style.display = 'none';
        return;
    }
    
    emptyDiv.style.display = 'none';
    table.style.display = 'table';
    
    tbody.innerHTML = multiDuties.map(m => {
        const counselorNames = m.counselorIds.map(id => {
            const c = counselors.find(counselor => counselor.id === id);
            return c ? c.name : '未知';
        }).filter(Boolean).join('、');
        
        return `
            <tr>
                <td>${m.date}</td>
                <td>${m.count}人</td>
                <td>${counselorNames}</td>
                <td>
                    <button class="btn-danger" onclick="deleteMultiDuty(${m.id})">删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

function deleteMultiDuty(id) {
    if (!confirm('确定要删除该多人值班设置吗？')) return;
    
    multiDuties = multiDuties.filter(m => m.id !== id);
    saveData();
    renderMultiDuties();
}

function updateMultiDutyCounselorList() {
    const container = document.getElementById('multiDutyCounselorList');
    const activeCounselors = counselors.filter(c => c.active);
    
    if (activeCounselors.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted);">暂无可用的辅导员</span>';
        return;
    }
    
    container.innerHTML = activeCounselors.map(c => `
        <label>
            <input type="checkbox" value="${c.id}" onchange="handleMultiDutyCheckboxChange(this)">
            ${c.name}
        </label>
    `).join('');
    
    // 初始化联动限制
    updateMultiDutyCheckboxLimit();
}

// 处理多人值班多选框变化
function handleMultiDutyCheckboxChange(checkbox) {
    const countInput = document.getElementById('multiDutyCount');
    const maxCount = parseInt(countInput.value) || 2;
    
    const checkedBoxes = document.querySelectorAll('#multiDutyCounselorList input:checked');
    const currentCount = checkedBoxes.length;
    
    // 更新提示
    updateMultiDutyHint(currentCount, maxCount);
    
    // 如果超过限制，取消当前选择并提示
    if (currentCount > maxCount) {
        checkbox.checked = false;
        alert(`最多只能选择 ${maxCount} 名值班人员`);
        updateMultiDutyHint(currentCount - 1, maxCount);
    }
}

// 更新多人值班多选框限制
function updateMultiDutyCheckboxLimit() {
    const countInput = document.getElementById('multiDutyCount');
    const maxCount = parseInt(countInput.value) || 2;
    
    // 确保值在1-10范围内
    if (maxCount < 1) {
        countInput.value = 1;
    } else if (maxCount > 10) {
        countInput.value = 10;
    }
    
    const checkedBoxes = document.querySelectorAll('#multiDutyCounselorList input:checked');
    const currentCount = checkedBoxes.length;
    
    // 如果当前选择超过新限制，取消多余的选择
    if (currentCount > maxCount) {
        // 保留前maxCount个选择
        for (let i = maxCount; i < checkedBoxes.length; i++) {
            checkedBoxes[i].checked = false;
        }
        updateMultiDutyHint(maxCount, maxCount);
    } else {
        updateMultiDutyHint(currentCount, maxCount);
    }
}

// 更新多人值班提示
function updateMultiDutyHint(current, max) {
    const hint = document.getElementById('multiDutyHint');
    hint.textContent = `已选择 ${current}/${max} 人`;
    
    // 根据选择情况改变颜色
    if (current === max) {
        hint.style.color = '#5ca97f'; // 绿色，已选满
    } else if (current === 0) {
        hint.style.color = '#d9645c'; // 红色，未选择
    } else {
        hint.style.color = '#7686a8'; // 灰色，正常
    }
}

// ==================== 老带新值班设置 ====================

function addMentorship() {
    const newbieSelect = document.getElementById('mentorshipNewbie');
    const startDateInput = document.getElementById('mentorshipStartDate');
    const endDateInput = document.getElementById('mentorshipEndDate');

    const newbieId = newbieSelect.value;
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    // 获取选中的值班搭档
    const selectedPartners = [];
    document.querySelectorAll('#mentorshipPartnerList input:checked').forEach(cb => {
        selectedPartners.push(parseInt(cb.value));
    });

    if (!newbieId) {
        alert('请选择新人辅导员');
        return;
    }

    if (!startDate || !endDate) {
        alert('请选择开始和结束日期');
        return;
    }

    if (startDate > endDate) {
        alert('开始日期不能晚于结束日期');
        return;
    }

    if (selectedPartners.length === 0) {
        alert('请至少选择一名值班搭档');
        return;
    }

    // 检查是否已存在该新人的设置（同一日期范围内）
    const hasOverlap = mentorshipSettings.some(m => {
        if (m.newbieId != newbieId) return false;
        return (startDate <= m.endDate && endDate >= m.startDate);
    });

    if (hasOverlap) {
        alert('该新人辅导员在选定的日期范围内已有老带新设置');
        return;
    }

    mentorshipSettings.push({
        id: Date.now(),
        newbieId: parseInt(newbieId),
        startDate: startDate,
        endDate: endDate,
        partnerIds: selectedPartners
    });

    // 按开始日期排序
    mentorshipSettings.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    saveData();
    renderMentorshipSettings();

    // 清空表单
    newbieSelect.value = '';
    startDateInput.value = '';
    endDateInput.value = '';
    document.querySelectorAll('#mentorshipPartnerList input').forEach(cb => cb.checked = false);
    updateMentorshipPartnerList();

    alert('老带新设置已添加');
}

function renderMentorshipSettings() {
    const tbody = document.getElementById('mentorshipList');
    const emptyDiv = document.getElementById('emptyMentorship');
    const table = document.getElementById('mentorshipTable');

    if (mentorshipSettings.length === 0) {
        tbody.innerHTML = '';
        emptyDiv.style.display = 'block';
        table.style.display = 'none';
        return;
    }

    emptyDiv.style.display = 'none';
    table.style.display = 'table';

    tbody.innerHTML = mentorshipSettings.map(m => {
        const newbie = counselors.find(c => c.id === m.newbieId);
        const newbieName = newbie ? newbie.name : '未知';

        const partnerNames = m.partnerIds.map(id => {
            const c = counselors.find(counselor => counselor.id === id);
            return c ? c.name : '未知';
        }).filter(Boolean).join('、');

        const dateRange = m.startDate === m.endDate
            ? m.startDate
            : `${m.startDate} 至 ${m.endDate}`;

        return `
            <tr>
                <td>${newbieName}</td>
                <td>${dateRange}</td>
                <td>${partnerNames}</td>
                <td>
                    <button class="btn-danger" onclick="deleteMentorship(${m.id})">删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

function deleteMentorship(id) {
    if (!confirm('确定要删除该老带新设置吗？')) return;

    mentorshipSettings = mentorshipSettings.filter(m => m.id !== id);
    saveData();
    renderMentorshipSettings();
}

function updateMentorshipNewbieSelect() {
    const select = document.getElementById('mentorshipNewbie');
    const activeCounselors = counselors.filter(c => c.active);

    select.innerHTML = '<option value="">-- 选择新人 --</option>' +
        activeCounselors.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function updateMentorshipPartnerList() {
    const container = document.getElementById('mentorshipPartnerList');
    const newbieSelect = document.getElementById('mentorshipNewbie');
    const newbieId = newbieSelect ? newbieSelect.value : '';

    // 获取可选的搭档（除新人外的其他活跃辅导员）
    const availablePartners = counselors.filter(c => c.active && String(c.id) !== String(newbieId));

    if (availablePartners.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted);">暂无可用的值班搭档</span>';
        return;
    }

    container.innerHTML = availablePartners.map(c => `
        <label>
            <input type="checkbox" value="${c.id}">
            ${c.name}
        </label>
    `).join('');
}

// ==================== 辅导员最大值班天数设置 ====================

function addMaxDuty() {
    const counselorSelect = document.getElementById('maxDutyCounselor');
    const countInput = document.getElementById('maxDutyCount');
    
    const counselorId = counselorSelect.value;
    const count = parseInt(countInput.value);
    
    if (!counselorId) {
        alert('请选择辅导员');
        return;
    }
    
    if (!count || count < 1) {
        alert('请输入有效的最大值班天数');
        return;
    }
    
    // 使用字符串类型的key
    const strId = String(counselorId);
    maxDutyLimits[strId] = count;
    
    saveData();
    counselorSelect.value = '';
    countInput.value = '1';
    renderMaxDutyLimits();
}

function renderMaxDutyLimits() {
    const tbody = document.getElementById('maxDutyList');
    const emptyDiv = document.getElementById('emptyMaxDuty');
    const table = document.getElementById('maxDutyTable');
    
    const entries = Object.entries(maxDutyLimits);
    
    if (entries.length === 0) {
        tbody.innerHTML = '';
        emptyDiv.style.display = 'block';
        table.style.display = 'none';
        return;
    }
    
    emptyDiv.style.display = 'none';
    table.style.display = 'table';
    
    tbody.innerHTML = entries.map(([id, count]) => {
        const counselor = counselors.find(c => String(c.id) === String(id));
        const name = counselor ? counselor.name : '未知';
        
        return `
            <tr>
                <td>${name}</td>
                <td>最多${count}次</td>
                <td>
                    <button class="btn-danger" onclick="deleteMaxDuty('${id}')">删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

function deleteMaxDuty(counselorId) {
    if (!confirm('确定要删除该最大值班天数限制吗？')) return;
    
    delete maxDutyLimits[counselorId];
    saveData();
    renderMaxDutyLimits();
}

function updateMaxDutyCounselorSelect() {
    const select = document.getElementById('maxDutyCounselor');
    const activeCounselors = counselors.filter(c => c.active);
    
    select.innerHTML = '<option value="">-- 选择辅导员 --</option>' +
        activeCounselors.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

// ==================== 辅导员不可值班时间设置 ====================

function loadRestrictions() {
    const counselorId = document.getElementById('restrictionCounselor').value;
    const panel = document.getElementById('restrictionPanel');
    
    if (!counselorId) {
        panel.style.display = 'none';
        return;
    }
    
    panel.style.display = 'block';
    
    // 重置当前限制为空
    currentRestrictions = {
        weekdays: [],
        dates: [],
        periods: []
    };
    
    // 清空所有输入框
    document.getElementById('restrictedDate').value = '';
    document.getElementById('periodStart').value = '';
    document.getElementById('periodEnd').value = '';
    
    // 加载已保存的限制（同时处理字符串和数字类型的key）
    const strId = String(counselorId);
    const numId = parseInt(counselorId);
    if (restrictions[strId]) {
        currentRestrictions = JSON.parse(JSON.stringify(restrictions[strId]));
    } else if (restrictions[numId]) {
        currentRestrictions = JSON.parse(JSON.stringify(restrictions[numId]));
    }
    
    // 更新UI
    updateRestrictionUI();
}

function updateRestrictionUI() {
    // 更新星期选择
    document.querySelectorAll('.weekday-checkboxes input').forEach(cb => {
        cb.checked = currentRestrictions.weekdays.includes(parseInt(cb.value));
    });
    
    // 更新日期列表
    renderRestrictedDates();
    
    // 更新时间段列表
    renderRestrictedPeriods();
}

function addRestrictedDate() {
    const dateInput = document.getElementById('restrictedDate');
    const date = dateInput.value;
    
    if (!date) {
        alert('请选择日期');
        return;
    }
    
    if (currentRestrictions.dates.includes(date)) {
        alert('该日期已添加');
        return;
    }
    
    currentRestrictions.dates.push(date);
    currentRestrictions.dates.sort();
    renderRestrictedDates();
    dateInput.value = '';
}

function renderRestrictedDates() {
    const container = document.getElementById('restrictedDatesList');
    container.innerHTML = currentRestrictions.dates.map(date => `
        <span class="tag">
            ${date}
            <span class="remove" onclick="removeRestrictedDate('${date}')">×</span>
        </span>
    `).join('');
}

function removeRestrictedDate(date) {
    currentRestrictions.dates = currentRestrictions.dates.filter(d => d !== date);
    renderRestrictedDates();
}

function addRestrictedPeriod() {
    const startInput = document.getElementById('periodStart');
    const endInput = document.getElementById('periodEnd');
    
    const start = startInput.value;
    const end = endInput.value;
    
    if (!start || !end) {
        alert('请选择开始和结束日期');
        return;
    }
    
    if (start > end) {
        alert('开始日期不能晚于结束日期');
        return;
    }
    
    // 检查是否重叠
    const hasOverlap = currentRestrictions.periods.some(p => {
        return (start <= p.end && end >= p.start);
    });
    
    if (hasOverlap) {
        alert('该时间段与已有时间段重叠');
        return;
    }
    
    currentRestrictions.periods.push({ start, end });
    currentRestrictions.periods.sort((a, b) => a.start.localeCompare(b.start));
    renderRestrictedPeriods();
    
    startInput.value = '';
    endInput.value = '';
}

function renderRestrictedPeriods() {
    const container = document.getElementById('restrictedPeriodsList');
    container.innerHTML = currentRestrictions.periods.map((p, index) => `
        <span class="tag">
            ${p.start} 至 ${p.end}
            <span class="remove" onclick="removeRestrictedPeriod(${index})">×</span>
        </span>
    `).join('');
}

function removeRestrictedPeriod(index) {
    currentRestrictions.periods.splice(index, 1);
    renderRestrictedPeriods();
}

function saveRestrictions() {
    const counselorId = document.getElementById('restrictionCounselor').value;
    
    if (!counselorId) return;
    
    // 收集选中的星期
    currentRestrictions.weekdays = [];
    document.querySelectorAll('.weekday-checkboxes input:checked').forEach(cb => {
        currentRestrictions.weekdays.push(parseInt(cb.value));
    });
    
    // 使用字符串类型作为key，确保一致性
    const strId = String(counselorId);
    restrictions[strId] = JSON.parse(JSON.stringify(currentRestrictions));
    saveData();
    renderRestrictionSummary();

    alert('限制设置已保存');
}

function resetRestrictions() {
    const counselorId = document.getElementById('restrictionCounselor').value;
    
    if (!counselorId) return;
    
    if (!confirm('确定要重置该辅导员的所有限制设置吗？')) return;
    
    // 清空当前限制
    currentRestrictions = {
        weekdays: [],
        dates: [],
        periods: []
    };
    
    // 从存储中删除（同时处理字符串和数字类型的key）
    const numericId = parseInt(counselorId);
    delete restrictions[counselorId];
    delete restrictions[numericId];
    saveData();
    renderRestrictionSummary();

    // 强制清空所有UI元素
    // 清空星期选择
    document.querySelectorAll('.weekday-checkboxes input').forEach(cb => {
        cb.checked = false;
    });
    
    // 清空日期列表
    document.getElementById('restrictedDatesList').innerHTML = '';
    
    // 清空时间段列表
    document.getElementById('restrictedPeriodsList').innerHTML = '';
    
    // 清空日期输入框
    document.getElementById('restrictedDate').value = '';
    document.getElementById('periodStart').value = '';
    document.getElementById('periodEnd').value = '';
    
    alert('限制设置已重置');
}

// 渲染限制记录汇总表
function renderRestrictionSummary() {
    const tbody = document.getElementById('restrictionSummaryList');
    const emptyDiv = document.getElementById('emptyRestrictionSummary');
    const table = document.getElementById('restrictionSummaryTable');

    const weekdayMap = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' };

    // 收集所有有限制的辅导员
    const entries = [];
    for (const [id, restr] of Object.entries(restrictions)) {
        const counselor = counselors.find(c => String(c.id) === String(id));
        if (!counselor) continue;
        const hasContent = (restr.weekdays && restr.weekdays.length > 0) ||
                           (restr.dates && restr.dates.length > 0) ||
                           (restr.periods && restr.periods.length > 0);
        if (hasContent) {
            entries.push({ id: String(id), name: counselor.name, restr });
        }
    }

    if (entries.length === 0) {
        tbody.innerHTML = '';
        emptyDiv.style.display = 'block';
        table.style.display = 'none';
        return;
    }

    emptyDiv.style.display = 'none';
    table.style.display = 'table';

    tbody.innerHTML = entries.map(e => {
        const weekdays = (e.restr.weekdays && e.restr.weekdays.length > 0)
            ? e.restr.weekdays.map(w => weekdayMap[w] || w).join('、')
            : '<span style="color: var(--text-muted);">无</span>';

        const dates = (e.restr.dates && e.restr.dates.length > 0)
            ? e.restr.dates.join('、')
            : '<span style="color: var(--text-muted);">无</span>';

        const periods = (e.restr.periods && e.restr.periods.length > 0)
            ? e.restr.periods.map(p => `${p.start} 至 ${p.end}`).join('；')
            : '<span style="color: var(--text-muted);">无</span>';

        return `
            <tr>
                <td>${e.name}</td>
                <td>${weekdays}</td>
                <td>${dates}</td>
                <td>${periods}</td>
                <td>
                    <button class="btn-danger" onclick="deleteRestrictionSummary('${e.id}')">删除</button>
                </td>
            </tr>
        `;
    }).join('');
}

// 从汇总表中删除某位辅导员的限制记录
function deleteRestrictionSummary(counselorId) {
    const counselor = counselors.find(c => String(c.id) === String(counselorId));
    const name = counselor ? counselor.name : '该辅导员';

    if (!confirm(`确定要删除 ${name} 的所有限制记录吗？`)) return;

    delete restrictions[counselorId];
    const numericId = parseInt(counselorId);
    delete restrictions[numericId];
    saveData();
    renderRestrictionSummary();

    // 如果当前正在编辑该辅导员的限制，刷新面板
    const currentId = document.getElementById('restrictionCounselor').value;
    if (String(currentId) === String(counselorId)) {
        loadRestrictions();
    }

    alert(`已删除 ${name} 的限制记录`);
}

// ==================== 排班生成 ====================

let currentSchedule = [];

function generateSchedule() {
    const startDateInput = document.getElementById('scheduleStartDate');
    const endDateInput = document.getElementById('scheduleEndDate');
    
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;
    
    if (!startDate || !endDate) {
        alert('请选择开始和结束日期');
        return;
    }
    
    if (startDate > endDate) {
        alert('开始日期不能晚于结束日期');
        return;
    }
    
    const activeCounselors = counselors.filter(c => c.active);
    if (activeCounselors.length === 0) {
        alert('没有可参与值班的辅导员，请先添加并启用辅导员');
        return;
    }
    
    // 生成日期列表
    const dates = [];
    let currentDate = new Date(startDate);
    const end = new Date(endDate);
    
    while (currentDate <= end) {
        dates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // 使用智能排班算法
    currentSchedule = generateSmartSchedule(dates, activeCounselors);
    
    renderSchedule(startDate, endDate);
}

function generateSmartSchedule(dates, activeCounselors) {
    const schedule = [];
    const counselorStats = {};
    activeCounselors.forEach(c => counselorStats[c.id] = 0);

    // 记录每个辅导员最近一次周末值班的时间
    const lastWeekendDuty = {};
    activeCounselors.forEach(c => lastWeekendDuty[c.id] = null);

    // 记录每个辅导员的周末值班次数（用于周末平均分配）
    const weekendDutyStats = {};
    activeCounselors.forEach(c => weekendDutyStats[c.id] = 0);

    // 记录老带新搭档搭配次数（key: newbieId_partnerId, value: count）
    const mentorshipPartnerStats = {};

    // 辅助函数：检查辅导员是否达到最大值班天数
    const hasReachedMaxDuty = (counselorId) => {
        const strId = String(counselorId);
        const maxLimit = maxDutyLimits[strId];
        if (maxLimit !== undefined && counselorStats[counselorId] >= maxLimit) {
            return true;
        }
        return false;
    };
    
    // 节假日连续值班追踪：记录每个节假日当前轮到第几个人
    const holidayDutyTracker = {}; // key: holiday.id, value: { currentIndex, rotationOrder }
    
    // 预处理：为每个节假日计算值班轮转顺序
    holidays.forEach(h => {
        if (h.counselorIds.length > 0) {
            // 按值班次数从少到多排序，实现平均分配
            const sortedIds = [...h.counselorIds].sort((a, b) => {
                return (counselorStats[a] || 0) - (counselorStats[b] || 0);
            });
            holidayDutyTracker[h.id] = {
                currentIndex: 0,
                rotationOrder: sortedIds,
                consecutiveDays: 0,        // 当前人员已连续值班天数
                currentPersonId: null       // 当前连续值班的人员ID
            };
        }
    });
    
    // 遍历每一天
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const dateStr = formatDate(date);
        const weekday = date.getDay(); // 0=周日, 1=周一, ..., 5=周五, 6=周六
        const weekdayName = weekdayNames[weekday];
        
        // 检查是否是节假日
        const holiday = holidays.find(h => dateStr >= h.startDate && dateStr <= h.endDate);
        
        // 检查是否是节假日前一天（下一天是节假日开始日期）
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = formatDate(nextDate);
        const isDayBeforeHoliday = holidays.find(h => h.startDate === nextDateStr);
        
        let assignedCounselors = [];
        let note = '';
        let isWeekendDuty = false;
        
        // ===== 节假日前一天处理（需要和节假日第一天一致）=====
        if (isDayBeforeHoliday && !holiday) {
            // 当前是节假日前一天，需要按节假日值班规则排班
            if (isDayBeforeHoliday.counselorIds.length > 0) {
                const tracker = holidayDutyTracker[isDayBeforeHoliday.id];
                
                // 确保tracker已初始化且有人员
                if (tracker && tracker.rotationOrder && tracker.rotationOrder.length > 0) {
                    // 如果currentPersonId还未设置，设置为第一个可用的人
                    if (!tracker.currentPersonId) {
                        // 找第一个可用的指定人员
                        for (let k = 0; k < tracker.rotationOrder.length; k++) {
                            const tryId = tracker.rotationOrder[k];
                            const tryPerson = activeCounselors.find(c => c.id === tryId);
                            if (tryPerson && isCounselorAvailable(tryPerson.id, dateStr, weekday) && !hasReachedMaxDuty(tryPerson.id)) {
                                tracker.currentPersonId = tryId;
                                tracker.currentIndex = k;
                                tracker.consecutiveDays = 0;
                                break;
                            }
                        }
                    }
                    
                    // 计算总天数：节假日前一天 + 节假日天数
                    const holidayStart = new Date(isDayBeforeHoliday.startDate);
                    const holidayEnd = new Date(isDayBeforeHoliday.endDate);
                    const holidayDays = Math.round((holidayEnd - holidayStart) / (1000 * 60 * 60 * 24)) + 1;
                    const totalDays = 1 + holidayDays; // 前一天 + 节假日天数
                    const personCount = tracker.rotationOrder.length;
                    
                    // 每人连续值班天数
                    const daysPerPerson = Math.ceil(totalDays / personCount);
                    
                    // 确定值班人员
                    let dutyPerson = activeCounselors.find(c => c.id === tracker.currentPersonId);
                    if (!dutyPerson || !isCounselorAvailable(dutyPerson.id, dateStr, weekday) || hasReachedMaxDuty(dutyPerson.id)) {
                        // 当前人员不可用或已达上限，找下一个可用的人
                        for (let k = 0; k < personCount; k++) {
                            const tryId = tracker.rotationOrder[(tracker.currentIndex + k) % personCount];
                            const tryPerson = activeCounselors.find(c => c.id === tryId);
                            if (tryPerson && isCounselorAvailable(tryPerson.id, dateStr, weekday) && !hasReachedMaxDuty(tryPerson.id)) {
                                dutyPerson = tryPerson;
                                tracker.currentPersonId = tryId;
                                tracker.currentIndex = (tracker.currentIndex + k) % personCount;
                                tracker.consecutiveDays = 0;
                                break;
                            }
                        }
                    }
                    
                    if (dutyPerson) {
                        assignedCounselors = [dutyPerson.name];
                        counselorStats[dutyPerson.id]++;
                        tracker.consecutiveDays++;
                        note = `${isDayBeforeHoliday.name}前一天`;
                    }
                }
            }
        }
        
        // ===== 节假日处理 =====
        if (holiday && assignedCounselors.length === 0) {
            note = holiday.name;
            const isFirstDay = (dateStr === holiday.startDate);
            
            if (holiday.counselorIds.length > 0) {
                // 有指定值班人员：多人轮流连续值班
                const tracker = holidayDutyTracker[holiday.id];
                
                if (isFirstDay) {
                    // 节假日第一天：检查前一天是否已按节假日规则排班
                    if (i > 0) {
                        const prevDateStr = formatDate(dates[i - 1]);
                        const prevEntry = schedule.find(s => s.date === prevDateStr);
                        if (prevEntry && prevEntry.counselors[0] !== '未分配') {
                            // 前一天已安排，继续由该人员值班
                            const prevPerson = activeCounselors.find(c => c.name === prevEntry.counselors[0]);
                            if (prevPerson && holiday.counselorIds.includes(prevPerson.id) &&
                                isCounselorAvailable(prevPerson.id, dateStr, weekday) && !hasReachedMaxDuty(prevPerson.id)) {
                                tracker.currentPersonId = prevPerson.id;
                                // 不重置consecutiveDays，继续累计
                            }
                        }
                    }
                    
                    // 如果还没有初始化rotationOrder
                    if (!tracker.rotationOrder || tracker.rotationOrder.length === 0) {
                        const availableIds = holiday.counselorIds.filter(id => {
                            const person = activeCounselors.find(c => c.id === id);
                            return person && isCounselorAvailable(person.id, dateStr, weekday) && !hasReachedMaxDuty(person.id);
                        });
                        
                        if (availableIds.length > 0) {
                            const sorted = availableIds.sort((a, b) => {
                                return (counselorStats[a] || 0) - (counselorStats[b] || 0);
                            });
                            tracker.rotationOrder = sorted;
                            tracker.currentIndex = 0;
                            if (!tracker.currentPersonId) {
                                tracker.currentPersonId = sorted[0];
                            }
                            if (!tracker.consecutiveDays) {
                                tracker.consecutiveDays = 0;
                            }
                        } else {
                            tracker.rotationOrder = [];
                            tracker.currentPersonId = null;
                        }
                    }
                }
                
                // 如果有可用人员，进行排班
                if (tracker.rotationOrder && tracker.rotationOrder.length > 0) {
                    // 计算总天数：节假日前一天 + 节假日天数
                    const holidayStart = new Date(holiday.startDate);
                    const holidayEnd = new Date(holiday.endDate);
                    const holidayDays = Math.round((holidayEnd - holidayStart) / (1000 * 60 * 60 * 24)) + 1;
                    const totalDays = 1 + holidayDays; // 前一天 + 节假日天数
                    const personCount = tracker.rotationOrder.length;
                    // 每人连续值班天数
                    const daysPerPerson = Math.ceil(totalDays / personCount);
                    
                    // 检查是否需要切换到下一个人
                    if (tracker.consecutiveDays >= daysPerPerson) {
                        tracker.currentIndex = (tracker.currentIndex + 1) % personCount;
                        tracker.currentPersonId = tracker.rotationOrder[tracker.currentIndex];
                        tracker.consecutiveDays = 0;
                    }
                    
                    // 确定最终值班人员
                    let dutyPerson = activeCounselors.find(c => c.id === tracker.currentPersonId);
                    if (!dutyPerson || !isCounselorAvailable(dutyPerson.id, dateStr, weekday) || hasReachedMaxDuty(dutyPerson.id)) {
                        // 当前人员不可用或已达上限，找下一个可用的人
                        for (let k = 0; k < personCount; k++) {
                            const tryId = tracker.rotationOrder[(tracker.currentIndex + k) % personCount];
                            const tryPerson = activeCounselors.find(c => c.id === tryId);
                            if (tryPerson && isCounselorAvailable(tryPerson.id, dateStr, weekday) && !hasReachedMaxDuty(tryPerson.id)) {
                                dutyPerson = tryPerson;
                                tracker.currentPersonId = tryId;
                                tracker.currentIndex = (tracker.currentIndex + k) % personCount;
                                tracker.consecutiveDays = 0;
                                break;
                            }
                        }
                    }
                    
                    if (dutyPerson) {
                        assignedCounselors = [dutyPerson.name];
                        counselorStats[dutyPerson.id]++;
                        tracker.consecutiveDays++;
                    }
                }
                
            } else {
                // 没有指定值班人员，由系统自动分配
                if (isFirstDay && i > 0) {
                    const prevDateStr = formatDate(dates[i - 1]);
                    const prevEntry = schedule.find(s => s.date === prevDateStr);
                    if (prevEntry && prevEntry.counselors[0] !== '未分配') {
                        const prevPerson = activeCounselors.find(c => c.name === prevEntry.counselors[0]);
                        if (prevPerson && isCounselorAvailable(prevPerson.id, dateStr, weekday) && !hasReachedMaxDuty(prevPerson.id)) {
                            assignedCounselors = [prevPerson.name];
                            counselorStats[prevPerson.id]++;
                            note += ' (与前一天一致)';
                        }
                    }
                }
            }
        }
        
        // ===== 多人值班设置处理 =====
        if (assignedCounselors.length === 0) {
            const multiDuty = multiDuties.find(m => m.date === dateStr);
            if (multiDuty) {
                // 该日期设置了多人值班
                const availableCounselors = multiDuty.counselorIds
                    .map(id => activeCounselors.find(c => c.id === id))
                    .filter(c => {
                        if (!c) return false;
                        if (!isCounselorAvailable(c.id, dateStr, weekday)) return false;
                        if (hasReachedMaxDuty(c.id)) return false;

                        // 避免连续两天值班
                        if (schedule.length > 0) {
                            const prevDay = schedule[schedule.length - 1];
                            if (prevDay.counselors.includes(c.name)) return false;
                        }
                        const nextDayEntry = schedule.find(s => s.date === nextDateStr);
                        if (nextDayEntry && nextDayEntry.counselors.includes(c.name)) return false;

                        // 节假日前后排他规则
                        for (const h of holidays) {
                            const hStart = new Date(h.startDate);
                            const hEnd = new Date(h.endDate);
                            const before2 = new Date(hStart);
                            before2.setDate(before2.getDate() - 2);
                            const before1 = new Date(hStart);
                            before1.setDate(before1.getDate() - 1);
                            if ((dateStr === formatDate(before2) || dateStr === formatDate(before1)) && h.counselorIds.includes(c.id)) {
                                return false;
                            }
                            const afterEnd = new Date(hEnd);
                            afterEnd.setDate(afterEnd.getDate() + 1);
                            if (dateStr === formatDate(afterEnd) && h.counselorIds.includes(c.id)) {
                                return false;
                            }
                        }

                        return true;
                    });
                
                // 按值班次数排序，优先选择值班次数少的人员
                availableCounselors.sort((a, b) => counselorStats[a.id] - counselorStats[b.id]);
                
                // 选择指定人数的人员
                const selectedCount = Math.min(multiDuty.count, availableCounselors.length);
                for (let k = 0; k < selectedCount; k++) {
                    assignedCounselors.push(availableCounselors[k].name);
                    counselorStats[availableCounselors[k].id]++;
                }
                
                if (assignedCounselors.length > 0) {
                    note = `多人值班(${assignedCounselors.length}人)`;
                }
            }
        }
        
        // ===== 规则1 & 6：周五、周六、周日同一人值班，轮流值班 =====
        if (assignedCounselors.length === 0 && (weekday === 5 || weekday === 6 || weekday === 0)) {
            isWeekendDuty = true;
            
            if (weekday === 5) {
                // 周五：新的周末轮班开始
                const sortedCounselors = [...activeCounselors]
                    .filter(c => isCounselorAvailable(c.id, dateStr, weekday) && !hasReachedMaxDuty(c.id))
                    .sort((a, b) => {
                        // 优先按周末值班次数排序（确保周末平均分配）
                        const weekendDiff = weekendDutyStats[a.id] - weekendDutyStats[b.id];
                        if (weekendDiff !== 0) return weekendDiff;
                        // 其次按总值班次数排序
                        const countDiff = counselorStats[a.id] - counselorStats[b.id];
                        if (countDiff !== 0) return countDiff;
                        // 最后按上次周末值班时间排序
                        const lastA = lastWeekendDuty[a.id] ? new Date(lastWeekendDuty[a.id]) : new Date(0);
                        const lastB = lastWeekendDuty[b.id] ? new Date(lastWeekendDuty[b.id]) : new Date(0);
                        return lastA - lastB;
                    });
                
                if (sortedCounselors.length > 0) {
                    assignedCounselors = [sortedCounselors[0].name];
                    counselorStats[sortedCounselors[0].id]++;
                    weekendDutyStats[sortedCounselors[0].id]++;
                    lastWeekendDuty[sortedCounselors[0].id] = dateStr;
                }
            } else {
                // 周六或周日：沿用周五的值班人员
                const friday = new Date(date);
                if (weekday === 6) {
                    friday.setDate(friday.getDate() - 1);
                } else {
                    friday.setDate(friday.getDate() - 2);
                }
                const fridayStr = formatDate(friday);
                const fridaySchedule = schedule.find(s => s.date === fridayStr);
                
                if (fridaySchedule && fridaySchedule.counselors[0] !== '未分配') {
                    const fridayCounselor = activeCounselors.find(c => c.name === fridaySchedule.counselors[0]);
                    if (fridayCounselor && isCounselorAvailable(fridayCounselor.id, dateStr, weekday) && !hasReachedMaxDuty(fridayCounselor.id)) {
                        assignedCounselors = [fridayCounselor.name];
                        counselorStats[fridayCounselor.id]++;
                        weekendDutyStats[fridayCounselor.id]++;
                    }
                }
                
                if (assignedCounselors.length === 0) {
                    const sortedCounselors = [...activeCounselors]
                        .filter(c => isCounselorAvailable(c.id, dateStr, weekday) && !hasReachedMaxDuty(c.id))
                        .sort((a, b) => weekendDutyStats[a.id] - weekendDutyStats[b.id]);
                    
                    if (sortedCounselors.length > 0) {
                        assignedCounselors = [sortedCounselors[0].name];
                        counselorStats[sortedCounselors[0].id]++;
                        weekendDutyStats[sortedCounselors[0].id]++;
                    }
                }
            }
        }
        
        // ===== 普通工作日排班 =====
        if (assignedCounselors.length === 0) {
            const availableCounselors = activeCounselors.filter(c => {
                if (!isCounselorAvailable(c.id, dateStr, weekday)) return false;
                if (hasReachedMaxDuty(c.id)) return false; // 检查最大值班天数
                
                // 规则：避免连续两天值班（检查前一天和后一天）
                // 检查前一天
                if (schedule.length > 0) {
                    const prevDay = schedule[schedule.length - 1];
                    if (prevDay.counselors.includes(c.name)) return false;
                }
                // 检查后一天（如果已排过）
                const nextDayEntry = schedule.find(s => s.date === nextDateStr);
                if (nextDayEntry && nextDayEntry.counselors.includes(c.name)) return false;
                
                // 规则5：周末值班的辅导员，本周四和下周一不安排
                if (weekday === 4) {
                    const saturday = new Date(date);
                    saturday.setDate(saturday.getDate() + 2);
                    const sunday = new Date(date);
                    sunday.setDate(sunday.getDate() + 3);
                    const satStr = formatDate(saturday);
                    const sunStr = formatDate(sunday);
                    const hasWeekendDuty = schedule.some(s =>
                        (s.date === satStr || s.date === sunStr) &&
                        s.counselors.includes(c.name)
                    );
                    if (hasWeekendDuty) return false;
                }
                
                if (weekday === 1) {
                    const saturday = new Date(date);
                    saturday.setDate(saturday.getDate() - 2);
                    const sunday = new Date(date);
                    sunday.setDate(sunday.getDate() - 1);
                    const satStr = formatDate(saturday);
                    const sunStr = formatDate(sunday);
                    const hasWeekendDuty = schedule.some(s =>
                        (s.date === satStr || s.date === sunStr) &&
                        s.counselors.includes(c.name)
                    );
                    if (hasWeekendDuty) return false;
                }
                
                // 节假日前后排他规则：节假日开始前两天和结束后一天不排该节假日值班人员
                for (const h of holidays) {
                    const hStart = new Date(h.startDate);
                    const hEnd = new Date(h.endDate);
                    const hPersonIds = h.counselorIds;

                    // 节假日开始前两天
                    const before2 = new Date(hStart);
                    before2.setDate(before2.getDate() - 2);
                    const before1 = new Date(hStart);
                    before1.setDate(before1.getDate() - 1);

                    if ((dateStr === formatDate(before2) || dateStr === formatDate(before1)) && hPersonIds.includes(c.id)) {
                        return false;
                    }

                    // 节假日结束后一天
                    const afterEnd = new Date(hEnd);
                    afterEnd.setDate(afterEnd.getDate() + 1);
                    if (dateStr === formatDate(afterEnd) && hPersonIds.includes(c.id)) {
                        return false;
                    }
                }
                
                return true;
            });
            
            // 规则4：尽量平均安排
            availableCounselors.sort((a, b) => counselorStats[a.id] - counselorStats[b.id]);
            
            if (availableCounselors.length > 0) {
                assignedCounselors = [availableCounselors[0].name];
                counselorStats[availableCounselors[0].id]++;
            } else {
                // 所有可用辅导员都达到限制，标记为未分配（严格尊重最大值班天数限制）
                assignedCounselors = ['未分配'];
                note += (note ? '，' : '') + '所有辅导员已达最大值班天数限制';
            }
        }

        // ===== 老带新值班处理 =====
        // 检查当前日期是否在任一新人的老带新日期范围内
        // 且当前值班人员是新人，且是普通工作日（周一-周四）
        if (assignedCounselors.length === 1 && assignedCounselors[0] !== '未分配') {
            const currentPerson = activeCounselors.find(c => c.name === assignedCounselors[0]);
            if (currentPerson && weekday >= 1 && weekday <= 4) { // 周一至周四
                const mentorship = mentorshipSettings.find(m => {
                    if (m.newbieId !== currentPerson.id) return false;
                    return (dateStr >= m.startDate && dateStr <= m.endDate);
                });

                if (mentorship) {
                    // 从值班搭档中选择一位可用的搭档（优先选择搭配次数少的）
                    const availablePartners = mentorship.partnerIds
                        .map(id => activeCounselors.find(c => c.id === id))
                        .filter(c => {
                            if (!c) return false;
                            if (!isCounselorAvailable(c.id, dateStr, weekday)) return false;
                            if (hasReachedMaxDuty(c.id)) return false;

                            // 避免连续两天值班
                            if (schedule.length > 0) {
                                const prevDay = schedule[schedule.length - 1];
                                if (prevDay.counselors.includes(c.name)) return false;
                            }
                            const nextDayEntry = schedule.find(s => s.date === nextDateStr);
                            if (nextDayEntry && nextDayEntry.counselors.includes(c.name)) return false;

                            // 规则5：周末值班的辅导员，本周四和下周一不安排
                            if (weekday === 4) {
                                const saturday = new Date(date);
                                saturday.setDate(saturday.getDate() + 2);
                                const sunday = new Date(date);
                                sunday.setDate(sunday.getDate() + 3);
                                const satStr = formatDate(saturday);
                                const sunStr = formatDate(sunday);
                                if (schedule.some(s =>
                                    (s.date === satStr || s.date === sunStr) &&
                                    s.counselors.includes(c.name)
                                )) return false;
                            }
                            if (weekday === 1) {
                                const saturday = new Date(date);
                                saturday.setDate(saturday.getDate() - 2);
                                const sunday = new Date(date);
                                sunday.setDate(sunday.getDate() - 1);
                                const satStr = formatDate(saturday);
                                const sunStr = formatDate(sunday);
                                if (schedule.some(s =>
                                    (s.date === satStr || s.date === sunStr) &&
                                    s.counselors.includes(c.name)
                                )) return false;
                            }

                            // 节假日前后排他规则
                            for (const h of holidays) {
                                const hStart = new Date(h.startDate);
                                const hEnd = new Date(h.endDate);
                                const before2 = new Date(hStart);
                                before2.setDate(before2.getDate() - 2);
                                const before1 = new Date(hStart);
                                before1.setDate(before1.getDate() - 1);
                                if ((dateStr === formatDate(before2) || dateStr === formatDate(before1)) && h.counselorIds.includes(c.id)) {
                                    return false;
                                }
                                const afterEnd = new Date(hEnd);
                                afterEnd.setDate(afterEnd.getDate() + 1);
                                if (dateStr === formatDate(afterEnd) && h.counselorIds.includes(c.id)) {
                                    return false;
                                }
                            }

                            return true;
                        });

                    if (availablePartners.length > 0) {
                        // 按搭配次数排序，选择搭配次数最少的
                        availablePartners.sort((a, b) => {
                            const keyA = `${currentPerson.id}_${a.id}`;
                            const keyB = `${currentPerson.id}_${b.id}`;
                            return (mentorshipPartnerStats[keyA] || 0) - (mentorshipPartnerStats[keyB] || 0);
                        });

                        const partner = availablePartners[0];
                        assignedCounselors.push(partner.name);
                        counselorStats[partner.id]++;

                        // 更新搭档搭配次数
                        const statsKey = `${currentPerson.id}_${partner.id}`;
                        mentorshipPartnerStats[statsKey] = (mentorshipPartnerStats[statsKey] || 0) + 1;

                        note = note ? `${note} (老带新)` : '老带新';
                    }
                }
            }
        }

        schedule.push({
            date: dateStr,
            weekday: weekdayName,
            counselors: assignedCounselors.length > 0 ? assignedCounselors : ['未分配'],
            note: note,
            isHoliday: !!holiday,
            isWeekend: weekday === 0 || weekday === 6,
            isWeekendDuty: isWeekendDuty
        });
    }
    
    // ===== 二次调整：严格平均值班天数（差值≤1）=====
    // 两阶段平衡：工作日交换 → 周末整块交换
    balanceSchedule(schedule, activeCounselors, counselorStats);

    // 保存统计信息供后续使用
    schedule.counselorStats = counselorStats;

    return schedule;
}

// 二次调整：确保值班天数严格平均（两阶段平衡算法）
// 阶段1：交换普通工作日（保持所有其他规则）
// 阶段2：交换整个周末块（保持周五-周日同一人，但可能改变轮换顺序）
function balanceSchedule(schedule, activeCounselors, counselorStats) {
    // 重新计算统计（包含所有值班人员：单人、多人值班、老带新）
    const stats = {};
    activeCounselors.forEach(c => stats[c.id] = 0);
    schedule.forEach(s => {
        if (s.counselors[0] === '未分配') return;
        // 遍历所有值班人员，不仅仅是第一个
        s.counselors.forEach(name => {
            const person = activeCounselors.find(c => c.name === name);
            if (person) stats[person.id]++;
        });
    });

    // 找出可调整的普通工作日（非周末值班、非节假日、非多人值班、非节假日前一天、非老带新）
    const adjustableIndices = [];
    schedule.forEach((s, index) => {
        if (s.isWeekendDuty || s.isHoliday || s.counselors.length > 1) return;
        if (s.note && (s.note.includes('前一天') || s.note.includes('与前一天一致') || s.note.includes('已超限制') || s.note.includes('老带新'))) return;
        if (s.counselors[0] === '未分配') return;
        adjustableIndices.push(index);
    });

    // ===== 阶段1：工作日交换 =====
    let maxRounds = 100;
    while (maxRounds-- > 0) {
        const counts = Object.values(stats);
        const maxCount = Math.max(...counts);
        const minCount = Math.min(...counts);

        if (maxCount - minCount <= 1) return; // 已满足条件

        const maxPersonId = Object.entries(stats).find(([id, count]) => count === maxCount)?.[0];
        const minPersonId = Object.entries(stats).find(([id, count]) => count === minCount)?.[0];
        if (!maxPersonId || !minPersonId) break;

        const maxPerson = activeCounselors.find(c => c.id == maxPersonId);
        const minPerson = activeCounselors.find(c => c.id == minPersonId);
        if (!maxPerson || !minPerson) break;

        let swapped = false;
        for (const idx of adjustableIndices) {
            const entry = schedule[idx];
            if (entry.counselors[0] !== maxPerson.name) continue;

            const dateObj = new Date(entry.date);
            const weekday = dateObj.getDay();

            if (!isCounselorAvailable(minPerson.id, entry.date, weekday)) continue;

            // 检查最大值班天数限制
            const strId = String(minPerson.id);
            const maxLimit = maxDutyLimits[strId];
            if (maxLimit !== undefined && stats[minPerson.id] >= maxLimit) continue;

            // 检查规则5：如果该日期是周四或周一，检查周末值班冲突
            if (weekday === 4) {
                const saturday = new Date(dateObj);
                saturday.setDate(saturday.getDate() + 2);
                const sunday = new Date(dateObj);
                sunday.setDate(sunday.getDate() + 3);
                const satStr = formatDate(saturday);
                const sunStr = formatDate(sunday);
                const hasWeekendDuty = schedule.some(s =>
                    (s.date === satStr || s.date === sunStr) &&
                    s.counselors.includes(minPerson.name)
                );
                if (hasWeekendDuty) continue;
            }

            if (weekday === 1) {
                const saturday = new Date(dateObj);
                saturday.setDate(saturday.getDate() - 2);
                const sunday = new Date(dateObj);
                sunday.setDate(sunday.getDate() - 1);
                const satStr = formatDate(saturday);
                const sunStr = formatDate(sunday);
                const hasWeekendDuty = schedule.some(s =>
                    (s.date === satStr || s.date === sunStr) &&
                    s.counselors.includes(minPerson.name)
                );
                if (hasWeekendDuty) continue;
            }

            // 执行交换
            entry.counselors = [minPerson.name];
            stats[maxPersonId]--;
            stats[minPersonId]++;
            counselorStats[maxPersonId]--;
            counselorStats[minPersonId]++;
            swapped = true;
            break;
        }

        if (!swapped) break; // 工作日无法继续调整，进入阶段2
    }

    // 检查是否已满足条件
    const counts1 = Object.values(stats);
    if (Math.max(...counts1) - Math.min(...counts1) <= 1) return;

    // ===== 阶段2：周末整块交换 =====
    // 构建周末块列表
    const weekendBlocks = buildWeekendBlocks(schedule, activeCounselors);

    maxRounds = 100;
    while (maxRounds-- > 0) {
        const counts = Object.values(stats);
        const maxCount = Math.max(...counts);
        const minCount = Math.min(...counts);

        if (maxCount - minCount <= 1) return;

        const maxPersonId = Object.entries(stats).find(([id, count]) => count === maxCount)?.[0];
        const minPersonId = Object.entries(stats).find(([id, count]) => count === minCount)?.[0];
        if (!maxPersonId || !minPersonId) break;

        const maxPerson = activeCounselors.find(c => c.id == maxPersonId);
        const minPerson = activeCounselors.find(c => c.id == minPersonId);
        if (!maxPerson || !minPerson) break;

        // 找到maxPerson负责的周末块
        let swapped = false;
        for (const block of weekendBlocks) {
            if (block.personId != maxPersonId) continue;

            // 检查minPerson是否可以接管这个周末块
            if (canSwapWeekendBlock(block, minPerson, schedule, activeCounselors, stats)) {
                // 执行交换
                const blockDays = block.days;
                for (const dayEntry of blockDays) {
                    dayEntry.counselors = [minPerson.name];
                }
                stats[maxPersonId] -= blockDays.length;
                stats[minPersonId] += blockDays.length;
                counselorStats[maxPersonId] -= blockDays.length;
                counselorStats[minPersonId] += blockDays.length;
                swapped = true;
                break;
            }
        }

        if (!swapped) break; // 周末整块交换无法继续调整
    }
}

// 构建周末块列表（每个块包含周五/周六/周日中属于同一人的连续周末天数）
function buildWeekendBlocks(schedule, activeCounselors) {
    const blocks = [];
    const processedFridays = new Set();

    schedule.forEach((s, index) => {
        if (s.counselors[0] === '未分配') return;
        if (!s.isWeekendDuty) return;
        if (s.isHoliday) return; // 法定节假日不参与周末块交换
        if (s.note && (s.note.includes('前一天') || s.note.includes('与前一天一致'))) return;

        const dateObj = new Date(s.date);
        const weekday = dateObj.getDay();

        // 找到这个周末的周五
        let friday = new Date(dateObj);
        if (weekday === 6) friday.setDate(friday.getDate() - 1);
        else if (weekday === 0) friday.setDate(friday.getDate() - 2);
        const fridayStr = formatDate(friday);

        // 每个周末只处理一次
        if (processedFridays.has(fridayStr)) return;
        processedFridays.add(fridayStr);

        // 收集这个周末的所有天数（周五、周六、周日）
        const saturday = new Date(friday);
        saturday.setDate(saturday.getDate() + 1);
        const sunday = new Date(friday);
        sunday.setDate(sunday.getDate() + 2);
        const satStr = formatDate(saturday);
        const sunStr = formatDate(sunday);

        const fridayEntry = schedule.find(e => e.date === fridayStr);
        const satEntry = schedule.find(e => e.date === satStr);
        const sunEntry = schedule.find(e => e.date === sunStr);

        // 收集属于同一人的周末天数
        if (fridayEntry && fridayEntry.counselors[0] !== '未分配' && !fridayEntry.isHoliday) {
            const personName = fridayEntry.counselors[0];
            const person = activeCounselors.find(c => c.name === personName);
            if (!person) return;

            const days = [];
            if (fridayEntry.counselors[0] === personName && !fridayEntry.isHoliday &&
                !(fridayEntry.note && (fridayEntry.note.includes('前一天') || fridayEntry.note.includes('与前一天一致')))) {
                days.push(fridayEntry);
            }
            if (satEntry && satEntry.counselors[0] === personName && !satEntry.isHoliday &&
                !(satEntry.note && (satEntry.note.includes('前一天') || satEntry.note.includes('与前一天一致')))) {
                days.push(satEntry);
            }
            if (sunEntry && sunEntry.counselors[0] === personName && !sunEntry.isHoliday &&
                !(sunEntry.note && (sunEntry.note.includes('前一天') || sunEntry.note.includes('与前一天一致')))) {
                days.push(sunEntry);
            }

            if (days.length > 0) {
                blocks.push({
                    fridayStr: fridayStr,
                    personId: person.id,
                    personName: personName,
                    days: days
                });
            }
        }
    });

    return blocks;
}

// 检查是否可以将周末块交换给目标人员
function canSwapWeekendBlock(block, targetPerson, schedule, activeCounselors, stats) {
    // 检查目标人员的最大值班天数限制
    const strId = String(targetPerson.id);
    const maxLimit = maxDutyLimits[strId];
    if (maxLimit !== undefined && stats[targetPerson.id] + block.days.length > maxLimit) return false;

    // 检查目标人员在周末块所有日期是否可用
    for (const dayEntry of block.days) {
        const dateObj = new Date(dayEntry.date);
        const weekday = dateObj.getDay();
        if (!isCounselorAvailable(targetPerson.id, dayEntry.date, weekday)) return false;
    }

    // 检查规则5：如果目标人员周四或下周一已值班，不能接管这个周末
    const friday = new Date(block.fridayStr);
    const thursday = new Date(friday);
    thursday.setDate(thursday.getDate() - 1);
    const thuStr = formatDate(thursday);
    const thuEntry = schedule.find(s => s.date === thuStr);
    if (thuEntry && thuEntry.counselors[0] === targetPerson.name) return false;

    const nextMonday = new Date(friday);
    nextMonday.setDate(nextMonday.getDate() + 3);
    const monStr = formatDate(nextMonday);
    const monEntry = schedule.find(s => s.date === monStr);
    if (monEntry && monEntry.counselors[0] === targetPerson.name) return false;

    return true;
}

// 检查辅导员是否可用
function isCounselorAvailable(counselorId, dateStr, weekday) {
    // 同时处理字符串和数字类型的key
    const strId = String(counselorId);
    const numId = parseInt(counselorId);
    
    // 查找限制设置（优先使用字符串key）
    let restr = restrictions[strId] || restrictions[numId];
    
    // 如果没有找到限制设置，说明该辅导员没有限制，返回可用
    if (!restr) return true;
    
    // 检查星期限制
    if (restr.weekdays && restr.weekdays.includes(weekday)) return false;
    
    // 检查日期限制
    if (restr.dates && restr.dates.includes(dateStr)) return false;
    
    // 检查时间段限制
    if (restr.periods && restr.periods.some(p => {
        return dateStr >= p.start && dateStr <= p.end;
    })) return false;
    
    return true;
}

function renderSchedule(startDate, endDate) {
    const resultDiv = document.getElementById('scheduleResult');
    const title = document.getElementById('scheduleTitle');
    const tbody = document.getElementById('scheduleList');
    const statsDiv = document.getElementById('statsContent');
    
    resultDiv.style.display = 'block';
    title.textContent = `${startDate} 至 ${endDate} 排班表`;
    
    tbody.innerHTML = currentSchedule.map(s => `
        <tr class="${s.isHoliday ? 'holiday-row' : ''} ${s.isWeekendDuty ? 'weekend-duty' : ''}">
            <td>${s.date}</td>
            <td class="${s.isWeekend ? 'weekend' : 'weekday'}">${s.weekday}</td>
            <td>${s.counselors.join('；')}</td>
            <td>${s.note}${s.isHoliday ? '<span class="holiday-badge">节假日</span>' : ''}</td>
        </tr>
    `).join('');
    
    // 计算四类统计数据
    const activeCounselors = counselors.filter(c => c.active);
    
    // 1. 总值班天数统计
    const totalStats = {};
    activeCounselors.forEach(c => totalStats[c.id] = 0);
    
    // 2. 法定节假日值班天数统计
    const holidayStats = {};
    activeCounselors.forEach(c => holidayStats[c.id] = 0);
    
    // 3. 周末值班次数统计（一次完整周末计一次，不含法定节假日）
    const weekendStats = {};
    activeCounselors.forEach(c => weekendStats[c.id] = 0);
    const processedWeekends = new Set(); // 记录已处理的周末
    
    // 4. 老带新或多人值班天数统计
    const multiPersonStats = {};
    activeCounselors.forEach(c => multiPersonStats[c.id] = 0);
    
    currentSchedule.forEach(s => {
        if (s.counselors[0] === '未分配') return;

        // 判断是否为多人值班或老带新
        const isMultiPerson = s.counselors.length > 1;

        // 统计所有值班人员（支持多人值班和老带新）
        s.counselors.forEach(counselorName => {
            const person = activeCounselors.find(c => c.name === counselorName);
            if (!person) return;

            // 总值班天数
            totalStats[person.id]++;

            // 法定节假日值班天数
            if (s.isHoliday) {
                holidayStats[person.id]++;
            }

            // 老带新或多人值班天数
            if (isMultiPerson) {
                multiPersonStats[person.id]++;
            }
        });
        
        // 周末值班次数（不含法定节假日）
        if (s.isWeekendDuty && !s.isHoliday) {
            // 计算该日期所属的周末（以周五的日期作为标识）
            const dateObj = new Date(s.date);
            const weekday = dateObj.getDay();
            let friday = new Date(dateObj);
            if (weekday === 6) friday.setDate(friday.getDate() - 1);
            else if (weekday === 0) friday.setDate(friday.getDate() - 2);
            const fridayStr = formatDate(friday);
            
            // 如果这个周末还没被统计过，统计该周末的值班人员
            if (!processedWeekends.has(fridayStr)) {
                processedWeekends.add(fridayStr);
                // 找到这个周末的值班人员（周五、周六、周日应该是同一人）
                const fridayEntry = currentSchedule.find(e => e.date === fridayStr);
                if (fridayEntry && fridayEntry.counselors[0] !== '未分配') {
                    const weekendPerson = activeCounselors.find(c => c.name === fridayEntry.counselors[0]);
                    if (weekendPerson) {
                        weekendStats[weekendPerson.id]++;
                    }
                }
            }
        }
    });
    
    // 构建统计数据
    const statsArray = activeCounselors.map(c => ({
        name: c.name,
        total: totalStats[c.id] || 0,
        holiday: holidayStats[c.id] || 0,
        weekend: weekendStats[c.id] || 0,
        multiPerson: multiPersonStats[c.id] || 0
    })).sort((a, b) => b.total - a.total);
    
    // 渲染统计表格
    statsDiv.innerHTML = `
        <table class="stats-table">
            <thead>
                <tr>
                    <th>辅导员</th>
                    <th>总值班天数</th>
                    <th>法定节假日值班</th>
                    <th>周末值班次数</th>
                    <th>老带新/多人值班</th>
                </tr>
            </thead>
            <tbody>
                ${statsArray.map(s => `
                    <tr>
                        <td>${s.name}</td>
                        <td>${s.total}天</td>
                        <td>${s.holiday}天</td>
                        <td>${s.weekend}次</td>
                        <td>${s.multiPerson}天</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    // 滚动到结果区域
    resultDiv.scrollIntoView({ behavior: 'smooth' });
}

function downloadExcel() {
    if (currentSchedule.length === 0) {
        alert('请先生成排班表');
        return;
    }
    
    const startDate = document.getElementById('scheduleStartDate').value;
    const endDate = document.getElementById('scheduleEndDate').value;
    
    // 准备数据
    const data = currentSchedule.map(s => ({
        '值班日期': s.date,
        '星期': s.weekday,
        '值班人员': s.counselors.join('；'),
        '备注': s.note
    }));
    
    // 创建工作簿
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    
    // 设置列宽
    ws['!cols'] = [
        { wch: 15 },
        { wch: 12 },
        { wch: 20 },
        { wch: 25 }
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, '排班表');
    XLSX.writeFile(wb, `辅导员排班表_${startDate}_至_${endDate}.xlsx`);
}

// ==================== 工具函数 ====================

function updateCounselorSelects() {
    updateHolidayCounselorCheckboxes();
    updateMultiDutyCounselorList();
    updateRestrictionCounselorSelect();
    updateMaxDutyCounselorSelect();
    updateMentorshipNewbieSelect();
    updateMentorshipPartnerList();
}

function updateHolidayCounselorCheckboxes() {
    const container = document.getElementById('holidayCounselorList');
    const activeCounselors = counselors.filter(c => c.active);
    
    if (activeCounselors.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted);">暂无可用的辅导员</span>';
        return;
    }
    
    container.innerHTML = activeCounselors.map(c => `
        <label>
            <input type="checkbox" value="${c.id}">
            ${c.name}
        </label>
    `).join('');
}

function updateRestrictionCounselorSelect() {
    const select = document.getElementById('restrictionCounselor');
    
    select.innerHTML = '<option value="">-- 请选择 --</option>' +
        counselors.filter(c => c.active).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function saveData() {
    saveLocal();
    pushToServer();
}

// 回车键提交
document.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        const activeElement = document.activeElement;
        if (activeElement.id === 'counselorName') {
            addCounselor();
        }
    }
});
