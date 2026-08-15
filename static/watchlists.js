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
        const row = document.createElement('div');
        row.className = 'drawer-row' + (list.id === currentWatchlistId ? ' active' : '');
        row.dataset.index = index;
        row.innerHTML = `
            <div class="drawer-row-bar"></div>
            <div class="drawer-row-name">${escapeHtml(list.name)}</div>
            <div class="drawer-row-count">${list.count}</div>`;
        row.addEventListener('click', () => switchWatchlist(list.id));
        container.appendChild(row);
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

/* ─── Task 6 佔位：管理模式與新增清單 ─── */

function toggleDrawerManageMode() {}
function showNewWatchlistForm() {}
