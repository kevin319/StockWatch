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

    const response = await fetch('/watchlists/' + encodeURIComponent(email));
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

/* ─── 切換清單 ─── */

async function switchWatchlist(id) {
    if (id !== currentWatchlistId) {
        currentWatchlistId = id;
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
            <div class="drawer-row-name">${escapeHtml(list.name)}</div>
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
        await fetch('/watchlists/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_email: email, ids: watchlists.map(w => w.id) }),
        });
    } catch (error) {
        console.error('更新清單順序時發生錯誤:', error);
    }
}

/* ─── 改名 ─── */

function startRenameWatchlist(id) {
    const index = watchlists.findIndex(w => w.id === id);
    if (index < 0) return;

    const row = document.querySelector('.drawer-row[data-index="' + index + '"]');
    if (!row) return;

    const nameEl = row.querySelector('.drawer-row-name');
    const original = watchlists[index].name;
    nameEl.innerHTML = `<input type="text" class="drawer-name-input" maxlength="50" value="${escapeHtml(original)}">`;

    const input = nameEl.querySelector('input');
    input.focus();
    input.select();

    let done = false;
    const commit = async () => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        if (!name || name === original) { renderWatchlistDrawer(); return; }
        await renameWatchlist(id, name);
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { done = true; renderWatchlistDrawer(); }
    });
}

async function renameWatchlist(id, name) {
    const email = getCurrentUserEmail();
    if (!email) return;
    try {
        const response = await fetch('/watchlists/' + id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_email: email, name: name }),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || '改名失敗');
        }
        const updated = await response.json();
        const index = watchlists.findIndex(w => w.id === id);
        if (index >= 0) watchlists[index].name = updated.name;
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
        const response = await fetch(
            '/watchlists/' + id + '?user_email=' + encodeURIComponent(email),
            { method: 'DELETE' }
        );
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
        if (e.key === 'Escape') hideNewWatchlistForm();
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
        const response = await fetch('/watchlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_email: email, name: name }),
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
async function refreshWatchlistCounts() {
    const email = getCurrentUserEmail();
    if (!email) return;
    try {
        const response = await fetch('/watchlists/' + encodeURIComponent(email));
        if (!response.ok) return;
        watchlists = await response.json();
        updateNavWatchlistName();
    } catch (error) {
        console.error('更新清單計數時發生錯誤:', error);
    }
}
