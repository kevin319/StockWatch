/* ═══════ WATCHLIST GROUPS ═══════
   清單狀態、左側抽屜、清單管理與清單選擇器。
   無建置流程：函式掛在全域，由 index.html 的 onclick 與 main.js 直接呼叫。 */

let watchlists = [];             // [{id, name, display_order, count}]
let currentWatchlistId = null;   // 目前檢視的清單 id
let drawerManageMode = false;    // 抽屜是否在管理模式（Task 6 使用）

const LS_CURRENT_WATCHLIST = 'sw-current-watchlist';

function getCurrentUserEmail() {
    try {
        const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
        return userInfo.email || null;
    } catch (e) {
        return null;
    }
}

// 載入清單列表，並把 currentWatchlistId 校正到一個實際存在的清單
async function loadWatchlists() {
    const email = getCurrentUserEmail();
    if (!email) throw new Error('找不到使用者資訊');

    const response = await authFetch('/watchlists');
    if (!response.ok) throw new Error('取得清單失敗');
    watchlists = await response.json();

    const saved = parseInt(localStorage.getItem(LS_CURRENT_WATCHLIST));
    const exists = watchlists.some(w => w.id === saved);
    // 記住的清單可能已被刪除，退回第一個
    currentWatchlistId = exists ? saved : (watchlists[0] ? watchlists[0].id : null);
    localStorage.setItem(LS_CURRENT_WATCHLIST, currentWatchlistId);

    updateNavWatchlistName();
}

function getCurrentWatchlist() {
    return watchlists.find(w => w.id === currentWatchlistId) || null;
}

function updateNavWatchlistName() {
    const el = document.getElementById('navWatchlistName');
    if (!el) return;
    const current = getCurrentWatchlist();
    el.textContent = current ? current.name : '自選股';
    updateNavArrows();
}

function updateNavArrows() {
    const prev = document.getElementById('navPrev');
    const next = document.getElementById('navNext');
    if (!prev || !next) return;
    const idx = watchlists.findIndex(w => w.id === currentWatchlistId);
    prev.hidden = idx <= 0;
    next.hidden = idx < 0 || idx >= watchlists.length - 1;
}

function navPrevList() {
    var id = getAdjacentWatchlistId(-1);
    if (id != null) slideToWatchlist(id, -1);
}

function navNextList() {
    var id = getAdjacentWatchlistId(1);
    if (id != null) slideToWatchlist(id, 1);
}

/* ─── 抽屜開合 ─── */

function openWatchlistDrawer() {
    renderWatchlistDrawer();
    document.getElementById('watchlistDrawerWrap').classList.remove('hidden');
}

function closeWatchlistDrawer() {
    document.getElementById('watchlistDrawerWrap').classList.add('hidden');
    drawerManageMode = false;
    const btn = document.getElementById('drawerManageBtn');
    if (btn) btn.classList.remove('active');
    hideNewWatchlistForm();
}

function toggleWatchlistDrawer() {
    const wrap = document.getElementById('watchlistDrawerWrap');
    if (wrap.classList.contains('hidden')) openWatchlistDrawer();
    else closeWatchlistDrawer();
}

/* ─── 抽屜內容 ─── */

function renderWatchlistDrawer() {
    const container = document.getElementById('watchlistDrawerList');
    if (!container) return;
    container.innerHTML = '';

    watchlists.forEach((list, index) => {
        container.appendChild(renderWatchlistRow(list, index));
    });
}

/* ─── 切換清單（含相鄰導覽） ─── */

function getAdjacentWatchlistId(direction) {
    if (watchlists.length < 2) return null;
    const idx = watchlists.findIndex(w => w.id === currentWatchlistId);
    const next = idx + direction;
    if (next < 0 || next >= watchlists.length) return null;
    return watchlists[next].id;
}

async function switchWatchlist(id) {
    if (id !== currentWatchlistId) {
        currentWatchlistId = id;
        collapsedGroups = {};
        localStorage.setItem(LS_CURRENT_WATCHLIST, id);
        updateNavWatchlistName();
        try {
            await loadCurrentWatchlistStocks();   // 定義在 main.js
        } catch (error) {
            console.error('切換清單時發生錯誤:', error);
            showToast('切換清單失敗，請稍後再試');
        } finally {
            closeWatchlistDrawer();
        }
        return;
    }
    closeWatchlistDrawer();
}

/* ─── 管理模式 ─── */

function toggleDrawerManageMode() {
    drawerManageMode = !drawerManageMode;
    const btn = document.getElementById('drawerManageBtn');
    if (btn) btn.classList.toggle('active', drawerManageMode);
    hideNewWatchlistForm();
    renderWatchlistDrawer();
}

// 抽屜列：一般模式可點擊切換，管理模式顯示拖曳把手、可點名稱改名、可刪除
function renderWatchlistRow(list, index) {
    const row = document.createElement('div');
    row.className = 'drawer-row'
        + (list.id === currentWatchlistId ? ' active' : '')
        + (drawerManageMode ? ' manage' : '');
    row.dataset.index = index;

    if (!drawerManageMode) {
        row.innerHTML = `
            <div class="drawer-row-bar"></div>
            <div class="drawer-row-info">
                <div class="drawer-row-name">${escapeHtml(list.name)}</div>
                ${list.description ? `<div class="drawer-row-desc">${escapeHtml(list.description)}</div>` : ''}
            </div>
            <div class="drawer-row-count">${list.count}</div>`;
        row.addEventListener('click', () => switchWatchlist(list.id));
        return row;
    }

    const canDelete = watchlists.length > 1;
    row.innerHTML = `
        <div class="drawer-row-bar"></div>
        <div class="drawer-row-name">${escapeHtml(list.name)}</div>
        <div class="drawer-drag drag-handle">${SVG_DRAG}</div>
        <button type="button" class="drawer-del" ${canDelete ? '' : 'disabled'}>${SVG_DELETE}</button>`;

    row.querySelector('.drawer-row-name').addEventListener('click', () => startRenameWatchlist(list.id));

    const delBtn = row.querySelector('.drawer-del');
    delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (canDelete) deleteWatchlist(list.id);
    });

    // 把手必須帶 drag-handle 這個 class：handleTouchStart/handleMouseDown 內部是用
    // e.target.closest('.drag-handle') 認把手的（Task 4 未把它參數化），少了就完全拖不動
    attachDragHandlers(row.querySelector('.drawer-drag'), {
        containerId: 'watchlistDrawerList',
        rowSelector: '.drawer-row',
        onReorder: (from, to) => {
            const item = watchlists[from];
            watchlists.splice(from, 1);
            watchlists.splice(to, 0, item);
            renderWatchlistDrawer();
            saveWatchlistOrder();
        },
    });

    return row;
}

async function saveWatchlistOrder() {
    const email = getCurrentUserEmail();
    if (!email) return;
    try {
        await authFetch('/watchlists/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: watchlists.map(w => w.id) }),
        });
    } catch (error) {
        console.error('更新清單順序時發生錯誤:', error);
        showToast('更新清單順序失敗，請稍後再試');
    }
}

/* ─── 改名 ─── */

function startRenameWatchlist(id) {
    const index = watchlists.findIndex(w => w.id === id);
    if (index < 0) return;

    const row = document.querySelector('.drawer-row[data-index="' + index + '"]');
    if (!row) return;

    const nameEl = row.querySelector('.drawer-row-name');
    if (nameEl.querySelector('input')) return;

    const list = watchlists[index];
    nameEl.innerHTML = `
        <input type="text" class="drawer-name-input" maxlength="50" value="${escapeHtml(list.name)}" placeholder="清單名稱">
        <input type="text" class="drawer-desc-input" maxlength="200" value="${escapeHtml(list.description || '')}" placeholder="說明（選填）">`;

    const nameInput = nameEl.querySelector('.drawer-name-input');
    const descInput = nameEl.querySelector('.drawer-desc-input');
    nameInput.focus();
    nameInput.select();

    let done = false;
    const commit = async () => {
        if (done) return;
        done = true;
        const name = nameInput.value.trim();
        const desc = descInput.value.trim();
        if (!name || (name === list.name && desc === (list.description || ''))) {
            renderWatchlistDrawer();
            return;
        }
        await renameWatchlist(id, name, desc);
    };

    const onKey = (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { e.stopPropagation(); done = true; renderWatchlistDrawer(); }
    };
    nameInput.addEventListener('keydown', onKey);
    descInput.addEventListener('keydown', onKey);
    descInput.addEventListener('blur', commit);
}

async function renameWatchlist(id, name, description) {
    const email = getCurrentUserEmail();
    if (!email) return;
    try {
        const body = { name };
        if (description !== undefined) body.description = description;
        const response = await authFetch('/watchlists/' + id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.detail || '改名失敗');
        }
        const updated = await response.json();
        const index = watchlists.findIndex(w => w.id === id);
        if (index >= 0) {
            watchlists[index].name = updated.name;
            watchlists[index].description = updated.description || '';
        }
        updateNavWatchlistName();
    } catch (error) {
        showToast(error.message);
    }
    renderWatchlistDrawer();
}

/* ─── 刪除 ─── */

async function deleteWatchlist(id) {
    const email = getCurrentUserEmail();
    if (!email) return;
    try {
        const response = await authFetch('/watchlists/' + id, { method: 'DELETE' });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '刪除失敗');
        }
        watchlists = watchlists.filter(w => w.id !== id);
        renderWatchlistDrawer();

        // 刪掉的是目前檢視的清單，退回第一個並重載
        if (id === currentWatchlistId) {
            currentWatchlistId = watchlists[0] ? watchlists[0].id : null;
            localStorage.setItem(LS_CURRENT_WATCHLIST, currentWatchlistId);
            updateNavWatchlistName();
            await loadCurrentWatchlistStocks();
        }
    } catch (error) {
        showToast(error.message);
    }
}

/* ─── 新增 ─── */

function showNewWatchlistForm() {
    const form = document.getElementById('watchlistNewForm');
    const input = document.getElementById('newWatchlistInput');
    if (!form || !input) return;

    form.classList.remove('hidden');
    input.value = '';
    input.focus();

    input.onkeydown = (e) => {
        if (e.key === 'Enter') createWatchlist(input.value.trim());
        if (e.key === 'Escape') { e.stopPropagation(); hideNewWatchlistForm(); }
    };
}

function hideNewWatchlistForm() {
    const form = document.getElementById('watchlistNewForm');
    if (form) form.classList.add('hidden');
}

async function createWatchlist(name) {
    const email = getCurrentUserEmail();
    if (!email || !name) return;
    try {
        const response = await authFetch('/watchlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name }),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '新增清單失敗');
        }
        watchlists.push(await response.json());
        hideNewWatchlistForm();
        renderWatchlistDrawer();
    } catch (error) {
        showToast(error.message);
    }
}

/* ─── 計數同步 ─── */

// 歸屬變動後重抓計數（不動 currentWatchlistId）
// 只更新既有清單的 count，不整批取代陣列：避免蓋掉可能還在進行中的
// 拖曳排序（POST /watchlists/reorder 尚未回來時，本地順序才是最新的）
async function refreshWatchlistCounts() {
    const email = getCurrentUserEmail();
    if (!email) return;
    try {
        const response = await authFetch('/watchlists');
        if (!response.ok) return;
        const serverLists = await response.json();
        const serverById = new Map(serverLists.map(w => [w.id, w]));

        // 更新既有清單的 count；伺服器已不存在的清單一併移除
        watchlists = watchlists
            .filter(w => serverById.has(w.id))
            .map(w => ({ ...w, count: serverById.get(w.id).count }));

        // 補上本地還不知道的新清單（接在後面，不影響既有順序）
        const knownIds = new Set(watchlists.map(w => w.id));
        serverLists.forEach(w => {
            if (!knownIds.has(w.id)) watchlists.push(w);
        });

        updateNavWatchlistName();
    } catch (error) {
        console.error('更新清單計數時發生錯誤:', error);
    }
}

/* ═══════ 清單選擇器 ═══════ */

let pickerTicker = null;        // 目前正在編輯歸屬的代號
let pickerSelected = new Set(); // 勾選中的清單 id
let pickerOriginal = new Set(); // 開啟當下伺服器端的實際歸屬（不含預選），用來判斷目前清單是否被異動

const SVG_CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

// 開啟選擇器；預先勾選該股票目前所屬的清單
async function openListPicker(ticker) {
    const email = getCurrentUserEmail();
    if (!email) return;

    pickerTicker = ticker;
    pickerSelected = new Set();

    try {
        const response = await authFetch(
            '/watchlist/memberships/' + encodeURIComponent(ticker)
        );
        if (response.ok) {
            (await response.json()).forEach(id => pickerSelected.add(id));
        }
    } catch (error) {
        console.error('取得歸屬時發生錯誤:', error);
    }

    pickerOriginal = new Set(pickerSelected); // 先存下真實歸屬，才套用下面的預選方便性

    // 尚未屬於任何清單時，預設勾選目前正在看的清單
    if (!pickerSelected.size && currentWatchlistId) pickerSelected.add(currentWatchlistId);

    document.getElementById('pickerTicker').textContent = ticker;
    renderListPicker();
    document.getElementById('listPickerWrap').classList.remove('hidden');
}

function renderListPicker() {
    const container = document.getElementById('pickerList');
    if (!container) return;
    container.innerHTML = '';

    watchlists.forEach(list => {
        const checked = pickerSelected.has(list.id);
        const row = document.createElement('div');
        row.className = 'picker-row' + (checked ? ' checked' : '');
        row.innerHTML = `
            <span class="picker-row-name">${escapeHtml(list.name)}</span>
            <span class="picker-check">${SVG_CHECK}</span>`;
        row.addEventListener('click', () => {
            if (pickerSelected.has(list.id)) pickerSelected.delete(list.id);
            else pickerSelected.add(list.id);
            renderListPicker();
        });
        container.appendChild(row);
    });
}

function closeListPicker() {
    document.getElementById('listPickerWrap').classList.add('hidden');
    pickerTicker = null;
    pickerSelected = new Set();
}

async function submitListPicker() {
    const email = getCurrentUserEmail();
    const ticker = pickerTicker;
    if (!email || !ticker) { closeListPicker(); return; }

    const ids = Array.from(pickerSelected);
    // 目前清單「之前」與「之後」的歸屬狀態不同，才需要重載列表
    // （只看最終狀態會漏掉「原本在目前清單、被取消勾選但仍留在其他清單」這種情況）
    const affectsCurrent = pickerOriginal.has(currentWatchlistId) !== ids.includes(currentWatchlistId);
    closeListPicker();

    try {
        const response = await authFetch('/watchlist/memberships', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticker: ticker, watchlist_ids: ids }),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '更新歸屬失敗');
        }

        await refreshWatchlistCounts();
        // 影響到目前清單才需要重載股票列表
        if (affectsCurrent || !ids.length) await loadCurrentWatchlistStocks();

        showToast(ids.length ? '已加入 ' + ids.length + ' 個清單' : '已從所有清單移除');
    } catch (error) {
        showToast(error.message);
    }
}


/* ═══════ 分組管理 ═══════ */

let currentGroups = [];

async function openGroupManager() {
    if (!currentWatchlistId) return;
    await loadGroups();
    renderGroupManager();
    document.getElementById('groupManagerWrap').classList.remove('hidden');
}

function closeGroupManager() {
    document.getElementById('groupManagerWrap').classList.add('hidden');
    document.getElementById('groupNewForm').classList.add('hidden');
    loadCurrentWatchlistStocks();
}

async function loadGroups() {
    try {
        const response = await authFetch('/watchlists/' + currentWatchlistId + '/groups');
        if (response.ok) currentGroups = await response.json();
    } catch (error) {
        console.error('載入分組失敗:', error);
    }
}

function renderGroupManager() {
    const container = document.getElementById('groupManagerList');
    if (!container) return;
    container.innerHTML = '';

    if (!currentGroups.length) {
        container.innerHTML = '<div style="padding:20px 4px;color:var(--text-tertiary);font-size:13px">還沒有分組，點下方「新增分組」建立</div>';
        return;
    }

    currentGroups.forEach((group, idx) => {
        const row = document.createElement('div');
        row.className = 'drawer-row manage';
        row.dataset.index = idx;
        row.innerHTML = `
            <div class="drawer-row-bar"></div>
            <div class="drawer-row-info" style="min-width:0">
                <div class="drawer-row-name">${escapeHtml(group.name)}</div>
                ${group.description ? `<div class="drawer-row-desc">${escapeHtml(group.description)}</div>` : ''}
                <div style="font:400 12px/1.3 var(--font);color:var(--text-tertiary);margin-top:2px">${group.count ?? 0} 檔</div>
            </div>
            <div class="drawer-row-actions">
                <button class="drawer-action-btn" onclick="event.stopPropagation();openGroupStockPicker(${group.id},'${escapeHtml(group.name)}')" title="管理股票">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>
                </button>
                <button class="drawer-action-btn" onclick="event.stopPropagation();promptRenameGroup(currentGroups[${idx}])" title="編輯">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
                </button>
                <button class="drawer-action-btn" onclick="event.stopPropagation();deleteGroup(${group.id})" title="刪除">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
            <div class="drawer-drag drag-handle">${SVG_DRAG}</div>`;
        attachDragHandlers(row.querySelector('.drawer-drag'), {
            containerId: 'groupManagerList',
            rowSelector: '.drawer-row',
            onReorder: (from, to) => {
                const item = currentGroups[from];
                currentGroups.splice(from, 1);
                currentGroups.splice(to, 0, item);
                renderGroupManager();
                saveGroupOrder();
            },
        });
        container.appendChild(row);
    });
}

function showNewGroupForm() {
    const form = document.getElementById('groupNewForm');
    form.classList.remove('hidden');
    const nameInput = document.getElementById('newGroupInput');
    const descInput = document.getElementById('newGroupDescInput');
    nameInput.value = '';
    descInput.value = '';
    nameInput.focus();
    const submit = async () => {
        const name = nameInput.value.trim();
        if (!name) return;
        const desc = descInput.value.trim();
        try {
            const response = await authFetch('/watchlists/' + currentWatchlistId + '/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description: desc }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.detail || '建立分組失敗');
            }
            form.classList.add('hidden');
            await loadGroups();
            renderGroupManager();
            showToast('已建立分組「' + name + '」');
        } catch (error) {
            showToast(error.message);
        }
    };
    const onKey = (e) => {
        if (e.key === 'Enter') submit();
        else if (e.key === 'Escape') form.classList.add('hidden');
    };
    nameInput.onkeydown = onKey;
    descInput.onkeydown = onKey;
}

function promptRenameGroup(group) {
    const rows = document.querySelectorAll('#groupManagerList .drawer-row');
    const row = [...rows].find(r => {
        const nameEl = r.querySelector('.drawer-row-name');
        return nameEl && nameEl.textContent === group.name;
    });
    if (!row) return;

    const infoEl = row.querySelector('.drawer-row-info');
    if (infoEl.querySelector('input')) return;

    infoEl.innerHTML = `
        <input type="text" class="drawer-name-input" maxlength="50" value="${escapeHtml(group.name)}" placeholder="分組名稱">
        <input type="text" class="drawer-desc-input" maxlength="200" value="${escapeHtml(group.description || '')}" placeholder="說明（選填）">`;

    const nameInput = infoEl.querySelector('.drawer-name-input');
    const descInput = infoEl.querySelector('.drawer-desc-input');
    nameInput.focus();
    nameInput.select();

    let done = false;
    const commit = async () => {
        if (done) return;
        done = true;
        const name = nameInput.value.trim();
        const desc = descInput.value.trim();
        if (!name || (name === group.name && desc === (group.description || ''))) {
            await loadGroups();
            renderGroupManager();
            return;
        }
        try {
            const response = await authFetch('/watchlists/' + currentWatchlistId + '/groups/' + group.id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description: desc }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.detail || '更新失敗');
            }
            await loadGroups();
            renderGroupManager();
            showToast('已更新');
        } catch (error) {
            showToast(error.message);
            await loadGroups();
            renderGroupManager();
        }
    };

    const onKey = (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { e.stopPropagation(); done = true; loadGroups().then(renderGroupManager); }
    };
    nameInput.addEventListener('keydown', onKey);
    descInput.addEventListener('keydown', onKey);
    nameInput.addEventListener('blur', () => setTimeout(() => { if (!infoEl.contains(document.activeElement)) commit(); }, 100));
    descInput.addEventListener('blur', () => setTimeout(() => { if (!infoEl.contains(document.activeElement)) commit(); }, 100));
}

async function saveGroupOrder() {
    try {
        await authFetch('/watchlists/' + currentWatchlistId + '/groups/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: currentGroups.map(g => g.id) }),
        });
    } catch (error) {
        console.error('更新分組順序失敗:', error);
        showToast('更新分組順序失敗');
    }
}

async function deleteGroup(groupId) {
    if (!confirm('刪除分組？股票不會被移除，只是回到未分組狀態。')) return;
    try {
        const response = await authFetch('/watchlists/' + currentWatchlistId + '/groups/' + groupId, {
            method: 'DELETE',
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '刪除分組失敗');
        }
        await loadGroups();
        renderGroupManager();
        showToast('已刪除分組');
    } catch (error) {
        showToast(error.message);
    }
}


/* ═══════ 分組股票選擇器 ═══════ */

let groupPickerGroupId = null;
let groupPickerSelected = new Set();

async function openGroupStockPicker(groupId, groupName) {
    groupPickerGroupId = groupId;
    groupPickerSelected = new Set();

    document.getElementById('groupPickerName').textContent = groupName;

    try {
        const response = await authFetch('/watchlists/' + currentWatchlistId + '/groups/' + groupId + '/stocks');
        if (response.ok) {
            (await response.json()).forEach(t => groupPickerSelected.add(t));
        }
    } catch (error) {
        console.error('取得分組股票失敗:', error);
    }

    renderGroupStockPicker();
    document.getElementById('groupStockPickerWrap').classList.remove('hidden');
}

function renderGroupStockPicker() {
    const container = document.getElementById('groupPickerList');
    if (!container) return;
    container.innerHTML = '';

    if (!stocks || !stocks.length) {
        container.innerHTML = '<div style="padding:20px;color:var(--text-tertiary);font-size:13px">清單中沒有股票</div>';
        return;
    }

    stocks.forEach(stock => {
        const checked = groupPickerSelected.has(stock.ticker);
        const row = document.createElement('div');
        row.className = 'picker-row' + (checked ? ' checked' : '');
        row.innerHTML = `
            <span class="picker-row-name">${stock.ticker}${stock.company_name && stock.company_name !== stock.ticker ? ' — ' + escapeHtml(stock.company_name) : ''}</span>
            <span class="picker-check">${SVG_CHECK}</span>`;
        row.addEventListener('click', () => {
            if (groupPickerSelected.has(stock.ticker)) groupPickerSelected.delete(stock.ticker);
            else groupPickerSelected.add(stock.ticker);
            renderGroupStockPicker();
        });
        container.appendChild(row);
    });
}

function closeGroupStockPicker() {
    document.getElementById('groupStockPickerWrap').classList.add('hidden');
    groupPickerGroupId = null;
    groupPickerSelected = new Set();
}

async function submitGroupStockPicker() {
    const groupId = groupPickerGroupId;
    const tickers = Array.from(groupPickerSelected);
    closeGroupStockPicker();

    try {
        const response = await authFetch('/watchlists/' + currentWatchlistId + '/groups/' + groupId + '/stocks', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tickers }),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '更新分組股票失敗');
        }
        await loadGroups();
        renderGroupManager();
        showToast('已更新分組');
    } catch (error) {
        showToast(error.message);
    }
}
