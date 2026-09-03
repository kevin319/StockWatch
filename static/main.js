function _fmtNum(v, ticker) {
    if (ticker && ticker.includes('=X')) return String(parseFloat(Number(v).toPrecision(10)));
    return Number(v).toFixed(2);
}

/* ═══════ 認證後的 API 呼叫 ═══════ */

// 所有需要登入的後端呼叫都走這裡：自動帶上 Bearer token；
// 收到 401 就代表憑證失效，直接登出回登入頁，不讓畫面停在半殘狀態。
async function authFetch(url, options) {
    options = options || {};
    const token = localStorage.getItem('access_token');
    const headers = Object.assign({}, options.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const response = await fetch(url, Object.assign({}, options, { headers: headers }));
    if (response.status === 401) {
        logout(); // 定義於 index.html：清 localStorage 並導回登入頁
        throw new Error('登入已過期，請重新登入');
    }
    return response;
}


/* ═══════ 前端版本檢查 ═══════ */

// 分頁長時間開著時，後端可能已經換版；舊前端會去打已經不存在的端點而失敗。
// 載入時記下版本，之後每次輪詢比對一次，不一致就自動重載拿新版。
let loadedAssetVersion = null;

async function checkAssetVersion() {
    try {
        const response = await fetch('/version', { cache: 'no-store' });
        if (!response.ok) return;
        const { version } = await response.json();
        if (!version) return;

        if (loadedAssetVersion === null) {
            loadedAssetVersion = version;
        } else if (version !== loadedAssetVersion) {
            location.reload();
        }
    } catch (e) {
        // 網路暫時不通就跳過，下次輪詢再比
    }
}


/* ═══════ THEME ═══════ */

function loadTheme() {
    var saved = localStorage.getItem('sw-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeToggle(saved);
}

function setTheme(theme) {
    localStorage.setItem('sw-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeToggle(theme);
}

/* ═══════ DISPLAY SETTINGS ═══════ */

function showChart() { return localStorage.getItem('sw-show-chart') !== 'false'; }
function showSummary() { return localStorage.getItem('sw-show-summary') !== 'false'; }
function groupCollapseMode() { return localStorage.getItem('sw-group-collapse') || 'all-open'; }
function setGroupCollapseMode(v) {
    localStorage.setItem('sw-group-collapse', v);
    collapsedGroups = {};
    renderStocks();
    updateGroupCollapseToggle();
}
var collapsedGroups = {};

function setShowChart(v) {
    localStorage.setItem('sw-show-chart', v ? 'true' : 'false');
    if (expandedTicker) {
        var detail = document.querySelector('.stock-detail');
        if (detail) { detail.innerHTML = detailHtml(expandedTicker); scheduleChartRender(expandedTicker); }
    }
}

function setShowSummary(v) {
    localStorage.setItem('sw-show-summary', v ? 'true' : 'false');
    if (expandedTicker) {
        var detail = document.querySelector('.stock-detail');
        if (detail) detail.innerHTML = detailHtml(expandedTicker);
    }
}

function updateGroupCollapseToggle() {
    var toggle = document.getElementById('groupCollapseToggle');
    if (!toggle) return;
    var mode = groupCollapseMode();
    toggle.querySelectorAll('.seg-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    var thumb = toggle.querySelector('.seg-thumb');
    if (thumb) {
        var activeBtn = toggle.querySelector('.seg-btn.active');
        if (activeBtn) thumb.style.transform = 'translateX(' + activeBtn.offsetLeft + 'px)';
    }
}

function toggleGroupCollapse(groupKey) {
    collapsedGroups[groupKey] = !collapsedGroups[groupKey];
    renderStocks();
}

function updateThemeToggle(theme) {
    var toggle = document.getElementById('themeToggle');
    if (!toggle) return;
    var buttons = toggle.querySelectorAll('.seg-btn');
    buttons.forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
    var thumb = toggle.querySelector('.seg-thumb');
    if (thumb) {
        thumb.style.transform = theme === 'dark' ? 'translateX(100%)' : 'translateX(0)';
    }
}


/* ═══════ TILE GRADIENTS ═══════ */

const TILE_GRADIENTS = [
    'linear-gradient(160deg, #4fa3ff, #0066ff)',
    'linear-gradient(160deg, #ffb84d, #ff8800)',
    'linear-gradient(160deg, #b68cff, #7a4bff)',
    'linear-gradient(160deg, #ff80b3, #ff3380)',
    'linear-gradient(160deg, #5de08e, #1fb053)',
    'linear-gradient(160deg, #ff7a7a, #e03030)',
    'linear-gradient(160deg, #5cd1e0, #00a8c0)',
    'linear-gradient(160deg, #8a8aff, #5050ff)',
    'linear-gradient(160deg, #ffd97a, #e0a030)',
    'linear-gradient(160deg, #b5b5bc, #7a7a82)',
];

function getTileGradient(ticker) {
    let hash = 0;
    for (let i = 0; i < ticker.length; i++) {
        hash = ticker.charCodeAt(i) + ((hash << 5) - hash);
    }
    return TILE_GRADIENTS[Math.abs(hash) % TILE_GRADIENTS.length];
}

const SVG_DRAG = '<svg width="14" height="18" viewBox="0 0 14 18" fill="none"><circle cx="4" cy="3" r="1.2" fill="currentColor"/><circle cx="10" cy="3" r="1.2" fill="currentColor"/><circle cx="4" cy="9" r="1.2" fill="currentColor"/><circle cx="10" cy="9" r="1.2" fill="currentColor"/><circle cx="4" cy="15" r="1.2" fill="currentColor"/><circle cx="10" cy="15" r="1.2" fill="currentColor"/></svg>';

const SVG_DELETE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';

const SVG_ADD = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

const SVG_EMPTY = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M7 17l4-4 3 2 3-3"/></svg>';


/* ═══════ FEATURE FLAGS ═══════ */

// AI 對話（聊天面板）暫不開放。改成 true 即可恢復 nav 對話鈕與摘要區的「問 AI」。
// 注意：只關 UI，後端 /api/chat 仍在。AI 摘要不受此開關影響。
const AI_CHAT_ENABLED = false;


/* ═══════ STATE ═══════ */

let stocks = [];
let draggedItem = null;
let draggedItemIndex = null;
let touchStartY = null;
let currentTouchItem = null;
let dragCtx = null;        // 目前拖曳的上下文（容器、列選擇器、排序回呼）
let priceFlash = {}; // ticker -> 'up'|'down'，本次更新價格變動方向（供微閃爍）
let firstStockRender = true; // 首次渲染真實資料時做淡入
let expandedTicker = null;    // 目前展開基本面的代號（一次一個）
let fundData = {};            // ticker -> 基本面資料 / 'loading'
let summaryData = {};         // ticker -> AI 摘要文字 / 'loading'
let chartCache = {};          // "ticker:range" -> API 回傳資料 / 'loading'
let chartRange = {};          // ticker -> 目前選取的時間區間
let expandAnimate = false;    // 一次性：本次重繪是否播放展開動畫
let chatContext = null;       // 從股票開啟聊天時的脈絡 {ticker, summary}；一般聊天為 null

/* ═══════ UI TOGGLES ═══════ */

function toggleChatWindow() {
    if (!AI_CHAT_ENABLED) return;
    const el = document.getElementById('chatWindow');
    const opening = el.classList.contains('hidden');
    el.classList.toggle('hidden');
    // 從一般聊天按鈕開啟：清除股票脈絡，標題回「AI 助理」
    if (opening) {
        chatContext = null;
        const titleEl = el.querySelector('.sheet-title');
        if (titleEl) titleEl.textContent = 'AI 助理';
        renderChatEmpty();
    }
}

// 聊天空狀態：打招呼 + 建議話題（點即送出）。全黑畫面不會告訴使用者能做什麼
function renderChatEmpty() {
    const box = document.getElementById('chatMessages');
    if (!box || box.querySelector('.chat-bubble')) return; // 已有對話則不覆蓋
    const chips = (chatContext && chatContext.ticker)
        ? [chatContext.ticker + ' 的投資亮點與風險？', '這份摘要再展開講講', '適合長期持有嗎？']
        : ['半導體產業的投資邏輯？', 'ETF 和個股該怎麼配置？', '怎麼判斷一支股票貴不貴？'];
    box.innerHTML = `<div class="chat-empty">
        <div class="chat-empty-title">想聊點什麼？</div>
        <div class="chat-empty-desc">可以問我個股、產業或投資觀念</div>
        <div class="chat-chips">${chips.map(c =>
            `<button class="chat-chip" onclick="sendSuggestion(this.textContent)">${c}</button>`).join('')}</div>
    </div>`;
}

function sendSuggestion(text) {
    const input = document.getElementById('messageInput');
    if (!input) return;
    input.value = text;
    sendMessage();
}

function toggleSettingsPage() {
    const el = document.getElementById('settingsPage');
    if (!el) return;
    el.classList.toggle('hidden');
    if (!el.classList.contains('hidden')) {
        updateThemeToggle(localStorage.getItem('sw-theme') || 'dark');
        var tc = document.getElementById('toggleChart');
        var ts = document.getElementById('toggleSummary');
        if (tc) tc.checked = showChart();
        if (ts) ts.checked = showSummary();
        updateGroupCollapseToggle();
        renderSettingsStockList();
    }
}


/* ═══════ MARKET STATE ═══════ */

function getMarketStateText(state) {
    switch (state) {
        case 'PRE':         return '盤前';
        case 'REGULAR':     return '交易中';
        case 'POST':
        case 'POSTPOST':
        case 'CLOSED':      return '已收盤';
        default:            return state || '';
    }
}

// 圓點只有一種語意：綠=交易中。其他狀態不顯示點（盤前/盤後已由文字行表達），
// 三態圓點需要使用者猜含義——需要解釋的 UI 就是失敗的 UI
function getMarketDotClass(state) {
    return state === 'REGULAR' ? 'market-dot-live' : '';
}

/* ═══════ MARKET CLOCK ═══════ */

// 各市場正規盤時段（當地分鐘數，週一至五；午休算休市）
const MARKETS = [
    { name: '美股', tz: 'America/New_York', sessions: [[570, 960]] },             // 09:30-16:00
    { name: '台股', tz: 'Asia/Taipei',      sessions: [[540, 810]] },             // 09:00-13:30
    { name: '港股', tz: 'Asia/Hong_Kong',   sessions: [[570, 720], [780, 960]] }, // 09:30-12:00, 13:00-16:00
    { name: '陸股', tz: 'Asia/Shanghai',    sessions: [[570, 690], [780, 900]] }, // 09:30-11:30, 13:00-15:00
];

// 取得某時區「現在」的星期(0=日..6=六)與當日分鐘數
function getZonedNow(tz) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    const wdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    let hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0; // 某些引擎午夜輸出 24
    return { weekday: wdays[map.weekday], minutes: hour * 60 + parseInt(map.minute, 10) };
}

function isTradingDay(weekday) { return weekday >= 1 && weekday <= 5; }

// 回傳 { open } 或 { open:false, countdownMin }（到下次開盤的分鐘數，以當地牆鐘計算）
function getMarketClockInfo(market) {
    const { weekday, minutes } = getZonedNow(market.tz);

    if (isTradingDay(weekday)) {
        for (const [open, close] of market.sessions) {
            if (minutes >= open && minutes < close) return { open: true };
        }
    }

    for (let offset = 0; offset < 8; offset++) {
        const wd = (weekday + offset) % 7;
        if (!isTradingDay(wd)) continue;
        for (const [open] of market.sessions) {
            const deltaMin = offset * 1440 + open - minutes;
            if (deltaMin > 0) return { open: false, countdownMin: deltaMin };
        }
    }
    return { open: false, countdownMin: null };
}

// 倒數帶中文單位——「12:28」會被誤讀成時刻，「12時28分」不會
function formatCountdown(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}時${m}分` : `${m}分`;
}

function renderMarketClock() {
    const board = document.getElementById('marketClock');
    if (!board) return;
    const pad = n => String(n).padStart(2, '0');
    let openCount = 0;

    board.innerHTML = MARKETS.map(m => {
        const info = getMarketClockInfo(m);
        let statusInner, sub = '';
        if (info.open) {
            openCount++;
            statusInner = '<span class="mb-dot"></span>交易中';
        } else if (info.countdownMin != null) {
            // 下次開盤的使用者當地時間 ≈ 現在 + 倒數分鐘（與倒數採同一近似）
            const openLocal = new Date(Date.now() + info.countdownMin * 60000);
            sub = pad(openLocal.getHours()) + ':' + pad(openLocal.getMinutes()) + '開';
            statusInner = formatCountdown(info.countdownMin);
        } else {
            statusInner = '休市';
        }
        return `<div class="mb-cell">
            <div class="mb-name">${m.name}</div>
            <div class="mb-status">${statusInner}</div>
            <div class="mb-sub">${sub}</div>
        </div>`;
    }).join('');

    const summary = document.getElementById('heroSummary');
    if (summary) summary.textContent = openCount ? openCount + '/4 交易中' : '全部休市';
}


/* ═══════ RENDER STOCKS ═══════ */

function tileHtml(stock) {
    const grad = getTileGradient(stock.ticker);
    const label = (stock.company_name || stock.ticker || '?').trim().charAt(0).toUpperCase();
    if (stock.logo_url) {
        return `<div class="v2-tile">
            <img src="${stock.logo_url}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <span class="tile-initial" style="display:none;background:${grad}">${label}</span>
        </div>`;
    }
    return `<div class="v2-tile"><span class="tile-initial" style="background:${grad}">${label}</span></div>`;
}

// 載入骨架（資料抵達前的優雅占位）
function renderSkeleton(n = 4) {
    const stockList = document.getElementById('stockList');
    if (!stockList) return;
    let html = '';
    for (let i = 0; i < n; i++) {
        html += `<div class="skeleton-row">
            <div class="sk sk-tile"></div>
            <div><div class="sk sk-line w1"></div><div class="sk sk-line w2"></div></div>
            <div class="sk sk-price"></div>
        </div>`;
    }
    stockList.innerHTML = html;
    const card = document.getElementById('stockListCard');
    if (card) card.style.display = '';
}

function renderStocks() {
    const stockList = document.getElementById('stockList');
    stockList.innerHTML = '';

    if (!stocks.length) {
        stockList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">${SVG_EMPTY}</div>
                <div class="empty-state-title">這個清單還沒有股票</div>
                <div class="empty-state-desc">使用下方搜尋列加入股票</div>
            </div>`;
        document.getElementById('stockListCard').style.display = '';
        updateHeroCaption();
        return;
    }

    let lastGroupId = undefined;
    const hasAnyGroup = stocks.some(s => s.group_id);
    let groupIndex = 0;

    stocks.forEach((stock, index) => {
        // 分組標題列
        if (hasAnyGroup && stock.group_id !== lastGroupId) {
            lastGroupId = stock.group_id;
            const groupKey = stock.group_id || '_ungrouped';
            if (!(groupKey in collapsedGroups)) {
                const mode = groupCollapseMode();
                collapsedGroups[groupKey] = mode === 'first-open' ? groupIndex > 0 : false;
            }
            const isCollapsed = collapsedGroups[groupKey];
            const hdr = document.createElement('div');
            hdr.className = 'group-header' + (isCollapsed ? ' collapsed' : '');
            const label = stock.group_id ? stock.group_name : '未分組';
            const desc = stock.group_id ? (stock.group_description || '') : '';
            const count = stocks.filter(s => (s.group_id || '_ungrouped') === groupKey).length;
            hdr.innerHTML = `<svg class="group-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`
                + `<span class="group-header-name">${escapeHtml(label)}</span>`
                + `<span class="group-header-count">${count}</span>`
                + (desc ? `<span class="group-header-desc">${escapeHtml(desc)}</span>` : '');
            hdr.addEventListener('click', () => toggleGroupCollapse(groupKey));
            stockList.appendChild(hdr);
            groupIndex++;
        }

        if (hasAnyGroup) {
            const groupKey = stock.group_id || '_ungrouped';
            if (collapsedGroups[groupKey]) return;
        }

        // 平盤（漲跌趨近 0）中性灰、不帶正負號——+0.00% 標紅是資訊謊言
        const flat = Math.abs(stock.price_change_percent) < 0.005;
        const up = stock.price_change >= 0;
        const changeClass = flat ? 'price-flat' : (up ? 'price-up' : 'price-down');
        const arrow = flat ? '' : (up ? '+' : '');
        const hasExtended = stock.extended_price && stock.extended_price > 0;
        const extFlat = Math.abs(stock.extended_change_percent) < 0.005;
        const extUp = stock.extended_change >= 0;
        const extClass = extFlat ? 'price-flat' : (extUp ? 'price-up' : 'price-down');
        const extArrow = extFlat ? '' : (extUp ? '+' : '');
        const extLabel = stock.extended_type === 'PRE_MARKET' ? '盤前' : '盤後';
        const dotClass = getMarketDotClass(stock.market_state);

        const item = document.createElement('div');
        item.className = 'stock-item';

        const row = document.createElement('div');
        const flashDir = priceFlash[stock.ticker];
        const isExpanded = expandedTicker === stock.ticker;
        row.className = 'v2-row' + (flashDir ? ' flash-' + flashDir : '') + (firstStockRender ? ' row-enter' : '') + (isExpanded ? ' expanded' : '');
        if (firstStockRender) row.style.animationDelay = (index * 40) + 'ms';
        row.innerHTML = `
            ${tileHtml(stock)}
            <div class="row-info">
                <div class="ty-row">
                    ${dotClass ? `<span class="market-dot ${dotClass}"></span>` : ''}${stock.ticker}
                </div>
                <div class="ty-subtitle">${(stock.company_name && stock.company_name !== stock.ticker) ? stock.company_name : ''}</div>
            </div>
            <div class="row-price">
                <span class="price-main">${_fmtNum(stock.price, stock.ticker)}</span>
                ${hasExtended ? `<span class="ext-price">${extLabel} ${_fmtNum(stock.extended_price, stock.ticker)}</span>` : ''}
            </div>
            <div class="row-change">
                <span class="price-change ${changeClass}">${arrow}${stock.price_change_percent.toFixed(2)}%</span>
                ${hasExtended
                    ? `<span class="ext-change ${extClass}">${extArrow}${stock.extended_change_percent.toFixed(2)}%</span>`
                    : `<span class="ext-change ${changeClass}">${arrow}${_fmtNum(stock.price_change, stock.ticker)}</span>`}
            </div>`;
        row.addEventListener('click', () => toggleExpand(stock.ticker));
        item.appendChild(row);

        if (isExpanded) {
            const detail = document.createElement('div');
            detail.className = 'stock-detail' + (expandAnimate ? ' detail-enter' : '');
            detail.innerHTML = detailHtml(stock.ticker);
            item.appendChild(detail);
            scheduleChartRender(stock.ticker);
        }

        stockList.appendChild(item);
    });

    firstStockRender = false;
    expandAnimate = false; // 展開動畫只播一次
    priceFlash = {}; // 閃爍只觸發一次
    updateHeroCaption();
    updateLastUpdateTime();
}

// 點擊股票列：展開/收合基本面（手風琴，一次一個）
function toggleExpand(ticker) {
    if (expandedTicker === ticker) {
        collapseDetail(); // 收合：先播放滑出動畫，結束後才移除
        return;
    }
    expandedTicker = ticker;
    expandAnimate = true;
    if (!(ticker in fundData)) loadFundamentals(ticker);
    if (showSummary() && !(ticker in summaryData)) loadSummary(ticker);
    if (showChart()) {
        if (!chartRange[ticker]) chartRange[ticker] = '3m';
        loadChartIfNeeded(ticker);
    }
    renderStocks();
}

function collapseDetail() {
    const detail = document.querySelector('.stock-detail');
    if (!detail) { expandedTicker = null; renderStocks(); return; }
    const row = detail.closest('.stock-item').querySelector('.v2-row');
    if (row) row.classList.remove('expanded');
    detail.classList.remove('detail-enter');
    detail.classList.add('detail-exit');
    detail.addEventListener('animationend', () => {
        expandedTicker = null;
        renderStocks();
    }, { once: true });
}

async function loadFundamentals(ticker) {
    fundData[ticker] = 'loading';
    try {
        const res = await authFetch('/fundamentals/' + ticker);
        fundData[ticker] = await res.json();
    } catch {
        fundData[ticker] = { error: true };
    }
    if (expandedTicker === ticker) {
        const detail = document.querySelector('.stock-detail');
        if (detail) { detail.innerHTML = detailHtml(ticker); scheduleChartRender(ticker); }
        else renderStocks();
    }
}

async function loadSummary(ticker, refresh) {
    summaryData[ticker] = 'loading';
    var _redraw = function() {
        if (expandedTicker === ticker) {
            var detail = document.querySelector('.stock-detail');
            if (detail) { detail.innerHTML = detailHtml(ticker); scheduleChartRender(ticker); }
            else renderStocks();
        }
    };
    if (!refresh) _redraw();
    try {
        var url = '/ai-summary/' + ticker;
        if (refresh) url += '?refresh=true';
        const res = await authFetch(url);
        const data = await res.json();
        if (data.cooldown) {
            _showToast('摘要在一小時內已更新，暫時無法重新產生');
            return;
        }
        summaryData[ticker] = data.summary || '';
    } catch {
        summaryData[ticker] = '';
    }
    _redraw();
}

function refreshSummary(ticker) {
    var btn = document.querySelector('.summary-refresh-btn');
    if (btn) btn.classList.add('spinning');
    loadSummary(ticker, true).finally(function() {
        var b = document.querySelector('.summary-refresh-btn');
        if (b) b.classList.remove('spinning');
    });
}

function _showToast(msg) {
    var existing = document.querySelector('.sw-toast');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'sw-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() { el.classList.add('show'); }, 10);
    setTimeout(function() { el.classList.remove('show'); setTimeout(function() { el.remove(); }, 300); }, 2500);
}

// 展開面板 HTML：基本面 grid + 走勢圖（可關）+ AI 摘要（可關）
function detailHtml(ticker) {
    return fundamentalsHtml(ticker)
        + (showChart() ? chartSectionHtml(ticker) : '')
        + (showSummary() ? summaryHtml(ticker) : '');
}

// 基本面面板 HTML（2 欄 × 3 列指標格 + 52 週區間位置條）
function fundamentalsHtml(ticker) {
    const d = fundData[ticker];
    if (!d || d === 'loading') {
        const sk = '<div class="metric"><div class="sk sk-line" style="width:55%"></div><div class="sk sk-line" style="width:42%;margin-top:6px"></div></div>';
        return `<div class="detail-grid">${sk.repeat(6)}</div>`;
    }
    if (d.error) return `<div class="detail-empty">無法取得基本面資料</div>`;

    const ratio = v => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(2);
    const money = v => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(2);
    const moneyNZ = v => (v == null || isNaN(v) || v === 0) ? '—' : Number(v).toFixed(2);
    const pct = v => (v == null || isNaN(v) || v === 0) ? '—' : Number(v).toFixed(2) + '%';

    const cells = [
        ['本益比', ratio(d.pe)],      ['股息', moneyNZ(d.dividend)],
        ['股價淨值比', ratio(d.pb)],  ['殖利率', pct(d.divYield)],
        ['股價營收比', ratio(d.ps)],  ['每股盈餘', money(d.eps)],
    ].filter(([, v]) => v !== '—');
    var grid = cells.length
        ? `<div class="detail-grid">${cells.map(([k, v]) =>
            `<div class="metric"><div class="metric-label">${k}</div><div class="metric-value">${v}</div></div>`).join('')}</div>`
        : '';
    return grid + week52RangeHtml(ticker, d);
}

// 52 週區間位置條：現價在高低點之間的落點，一眼看出相對位置
function week52RangeHtml(ticker, d) {
    const lo = Number(d.week52Low), hi = Number(d.week52High);
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return '';
    const stock = stocks.find(s => s.ticker === ticker);
    const price = stock ? Number(stock.price) : NaN;
    if (!isFinite(price) || price <= 0) return '';
    const pos = Math.min(100, Math.max(0, (price - lo) / (hi - lo) * 100));
    return `<div class="range52">
        <div class="metric-label">52週區間</div>
        <div class="range52-bar"><div class="range52-dot" style="left:${pos.toFixed(1)}%"></div></div>
        <div class="range52-ends"><span>${_fmtNum(lo, ticker)}</span><span>${_fmtNum(hi, ticker)}</span></div>
    </div>`;
}

// AI 摘要區 HTML：標題列（含 💬 對話按鈕）+ 摘要文字 + 免責
function summaryHtml(ticker) {
    const s = summaryData[ticker];
    let body;
    if (s === 'loading' || s === undefined) {
        body = `<div class="summary-skeleton">
            <div class="sk sk-line" style="width:92%"></div>
            <div class="sk sk-line" style="width:100%;margin-top:8px"></div>
            <div class="sk sk-line" style="width:78%;margin-top:8px"></div>
        </div>`;
    } else if (!s) {
        body = `<div class="summary-text summary-empty">目前沒有可用的摘要</div>`;
    } else {
        body = `<div class="summary-text">${escapeHtml(s)}</div>`;
    }
    const chatBtn = AI_CHAT_ENABLED
        ? `<button class="summary-chat-btn" aria-label="與 AI 討論這檔股票"
                    onclick="event.stopPropagation(); openStockChat('${ticker}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>問 AI
            </button>`
        : '';

    const refreshBtn = `<button class="summary-refresh-btn" aria-label="重新產生摘要"
                onclick="event.stopPropagation(); refreshSummary('${ticker}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>`;

    return `<div class="summary-section">
        <div class="summary-head">
            <span class="summary-title">AI 摘要</span>
            <span class="summary-head-actions">${chatBtn}${refreshBtn}</span>
        </div>
        ${body}
        <div class="summary-disclaimer">AI 生成，僅供參考</div>
    </div>`;
}

// 從股票面板開啟聊天：帶入脈絡並切換到聊天視窗
function openStockChat(ticker) {
    if (!AI_CHAT_ENABLED) return;
    const summary = (summaryData[ticker] && summaryData[ticker] !== 'loading') ? summaryData[ticker] : '';
    chatContext = { ticker, summary };

    const titleEl = document.querySelector('#chatWindow .sheet-title');
    if (titleEl) titleEl.textContent = '討論 ' + ticker;

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.innerHTML = '';

    const chatWindow = document.getElementById('chatWindow');
    if (chatWindow) chatWindow.classList.remove('hidden');
    renderChatEmpty();
}

/* ═══════ CHART 走勢圖 ═══════ */

const CHART_RANGES = ['24H','5D','1M','3M','1Y','5Y','Max'];
const CHART_RANGE_KEYS = ['24h','5d','1m','3m','1y','5y','max'];

function _fmtPrice(v, ticker) {
    if (v == null || isNaN(v)) return '—';
    if (ticker && ticker.includes('=X')) return String(parseFloat(Number(v).toPrecision(10)));
    return v >= 1000 ? v.toFixed(0) : v.toFixed(2);
}

function _maLegendHtml(ma20v, ma60v, ma120v, bbU, bbL, ticker) {
    return '<span class="chart-ma-item"><span class="chart-ma-dot chart-ma-dot-20"></span>MA20:<b>' + _fmtPrice(ma20v, ticker) + '</b></span>'
        + '<span class="chart-ma-item"><span class="chart-ma-dot chart-ma-dot-60"></span>MA60:<b>' + _fmtPrice(ma60v, ticker) + '</b></span>'
        + '<span class="chart-ma-item"><span class="chart-ma-dot chart-ma-dot-120"></span>MA120:<b>' + _fmtPrice(ma120v, ticker) + '</b></span>'
        + '<span class="chart-ma-item"><span class="chart-ma-dot chart-ma-dot-bb"></span>BB:<b>' + _fmtPrice(bbU, ticker) + '/' + _fmtPrice(bbL, ticker) + '</b></span>';
}

function _pctVsAvg(v, avg) {
    if (!avg || !v) return '';
    var pct = ((v - avg) / avg * 100).toFixed(2);
    return (pct >= 0 ? '+' : '') + pct + '%';
}

function chartSectionHtml(ticker) {
    var range = chartRange[ticker] || '3m';
    var key = ticker + ':' + range;
    var d = chartCache[key];
    var hasData = d && d !== 'loading' && !d.error && d.close && d.close.length;

    var btns = CHART_RANGES.map(function(label, i) {
        var active = CHART_RANGE_KEYS[i] === range ? ' active' : '';
        return '<button class="chart-range-btn' + active + '" onclick="event.stopPropagation();switchChartRange(\'' + ticker + '\',\'' + CHART_RANGE_KEYS[i] + '\')">' + label + '</button>';
    }).join('');

    // MA 圖例列（永遠顯示三項，避免 hover 時高度跳動）
    var maHtml = '';
    if (hasData) {
        maHtml = '<div class="chart-ma-legend">' + _maLegendHtml(_lastNonNull(d.ma20), _lastNonNull(d.ma60), _lastNonNull(d.ma120), _lastNonNull(d.bb_upper), _lastNonNull(d.bb_lower), ticker) + '</div>';
    }

    var safeId = ticker.replace(/\./g, '_');

    // 懸停資訊列（預設隱藏，hover 時顯示）
    var hoverHtml = hasData ? '<div class="chart-hover-info hover-idle" id="chartHover_' + safeId + '"></div>' : '';

    // 圖表區（含覆蓋的高低價標注 + overlay canvas）
    var body;
    if (!d || d === 'loading') {
        body = '<div class="chart-skeleton skeleton"></div>';
    } else if (!hasData) {
        body = '<div class="detail-empty">無法取得走勢資料</div>';
    } else {
        var hi = d.high, lo = d.low, avg = d.avg;
        var hiPct = _pctVsAvg(hi, avg);
        var loPct = _pctVsAvg(lo, avg);
        body = '<div class="chart-canvas-wrap" id="chartWrap_' + safeId + '">'
            + '<canvas id="chartCanvas_' + safeId + '"></canvas>'
            + '<canvas id="chartOverlay_' + safeId + '" class="chart-overlay-canvas"></canvas>'
            + '<div class="chart-overlay chart-overlay-tl"><span class="chart-ov-price price-up">' + _fmtPrice(hi, ticker) + '</span></div>'
            + '<div class="chart-overlay chart-overlay-tr"><span class="price-up">' + hiPct + '</span></div>'
            + '<div class="chart-overlay chart-overlay-avg"><span class="chart-ov-avg">' + _fmtPrice(avg, ticker) + '</span></div>'
            + '<div class="chart-overlay chart-overlay-bl"><span class="chart-ov-price price-down">' + _fmtPrice(lo, ticker) + '</span></div>'
            + '<div class="chart-overlay chart-overlay-br"><span class="price-down">' + loPct + '</span></div>'
            + '</div>';
    }

    // 底部列：時間切換 + MDD
    var mddText = (hasData && d.mdd != null) ? 'MDD ' + d.mdd + '%' : '';
    var footHtml = '<div class="chart-foot">'
        + '<div class="chart-range-bar">' + btns + '</div>'
        + '<span class="chart-mdd">' + mddText + '</span>'
        + '</div>';

    return '<div class="chart-section">'
        + hoverHtml
        + maHtml
        + body
        + footHtml
        + '</div>';
}

function _lastNonNull(arr) {
    if (!arr) return null;
    for (var i = arr.length - 1; i >= 0; i--) {
        if (arr[i] != null) return arr[i];
    }
    return null;
}

function loadChartIfNeeded(ticker) {
    var range = chartRange[ticker] || '3m';
    var key = ticker + ':' + range;
    if (key in chartCache) {
        scheduleChartRender(ticker);
        return;
    }
    chartCache[key] = 'loading';
    authFetch('/history/' + ticker + '?range=' + range)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            chartCache[key] = data;
            if (expandedTicker === ticker) {
                var detail = document.querySelector('.stock-detail');
                if (detail) { detail.innerHTML = detailHtml(ticker); scheduleChartRender(ticker); }
            }
        })
        .catch(function() {
            chartCache[key] = { error: true };
            if (expandedTicker === ticker) {
                var detail = document.querySelector('.stock-detail');
                if (detail) detail.innerHTML = detailHtml(ticker);
            }
        });
}

function switchChartRange(ticker, range) {
    var prevRange = chartRange[ticker] || '3m';
    chartRange[ticker] = range;
    var key = ticker + ':' + range;

    // 立刻更新按鈕 active 狀態（不重建整個 panel）
    document.querySelectorAll('.chart-range-btn').forEach(function(btn, i) {
        btn.classList.toggle('active', CHART_RANGE_KEYS[i] === range);
    });

    if (key in chartCache && chartCache[key] !== 'loading') {
        // 已有快取，直接重繪圖表區
        _replaceChartBody(ticker);
        scheduleChartRender(ticker);
    } else {
        // 無快取：保留舊圖表，fetch 完成後再替換
        chartCache[key] = 'loading';
        authFetch('/history/' + ticker + '?range=' + range)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                chartCache[key] = data;
                if (expandedTicker === ticker && chartRange[ticker] === range) {
                    _replaceChartBody(ticker);
                    scheduleChartRender(ticker);
                }
            })
            .catch(function() {
                chartCache[key] = { error: true };
                if (expandedTicker === ticker && chartRange[ticker] === range) {
                    _replaceChartBody(ticker);
                }
            });
    }
}

function _replaceChartBody(ticker) {
    var section = document.querySelector('.chart-section');
    if (!section) return;
    var detail = document.querySelector('.stock-detail');
    if (detail) { detail.innerHTML = detailHtml(ticker); scheduleChartRender(ticker); }
}

function scheduleChartRender(ticker) {
    requestAnimationFrame(function() { renderChart(ticker); });
}

function renderChart(ticker) {
    var range = chartRange[ticker] || '3m';
    var d = chartCache[ticker + ':' + range];
    if (!d || d === 'loading' || d.error || !d.close || !d.close.length) return;

    var canvasId = 'chartCanvas_' + ticker.replace(/\./g, '_');
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    var W = rect.width;
    var H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    var close = d.close;
    var vol = d.volume || [];
    var ma20 = d.ma20 || [];
    var ma60 = d.ma60 || [];
    var ma120 = d.ma120 || [];
    var bbUpper = d.bb_upper || [];
    var bbLower = d.bb_lower || [];
    var n = close.length;

    var hasVol = vol.some(function(v) { return v > 0; });
    var priceH = hasVol ? H * 0.78 : H;
    var volH = hasVol ? H * 0.18 : 0;
    var volTop = hasVol ? H * 0.82 : H;
    var padTop = 4;

    // 價格範圍
    var allPrices = close.slice();
    [ma20, ma60, ma120, bbUpper, bbLower].forEach(function(ma) {
        ma.forEach(function(v) { if (v != null) allPrices.push(v); });
    });
    var pMin = Math.min.apply(null, allPrices);
    var pMax = Math.max.apply(null, allPrices);
    if (pMax === pMin) { pMax += 1; pMin -= 1; }
    var pRange = pMax - pMin;

    function xOf(i) { return (i / (n - 1)) * W; }
    function yOf(v) { return padTop + (1 - (v - pMin) / pRange) * (priceH - padTop); }

    // 成交量範圍
    var vMax = vol.length ? Math.max.apply(null, vol) : 1;
    if (vMax === 0) vMax = 1;

    // 先畫成交量柱狀圖（volume 全為 0 時跳過，如外匯）
    var barW = Math.max(1, W / n - 0.5);
    if (hasVol) {
        for (var i = 0; i < vol.length; i++) {
            var barH = (vol[i] / vMax) * volH;
            if (barH < 1) barH = 1;
            var isUp = i === 0 || close[i] >= close[i - 1];
            ctx.fillStyle = isUp
                ? (isDark ? 'rgba(255,59,48,0.35)' : 'rgba(255,59,48,0.25)')
                : (isDark ? 'rgba(52,199,89,0.35)' : 'rgba(52,199,89,0.25)');
            ctx.fillRect(xOf(i) - barW / 2, volTop + volH - barH, barW, barH);
        }
    }

    // 面積圖：收盤價走勢
    var grad = ctx.createLinearGradient(0, 0, 0, priceH);
    if (close[n - 1] >= close[0]) {
        grad.addColorStop(0, isDark ? 'rgba(255,59,48,0.30)' : 'rgba(255,59,48,0.18)');
        grad.addColorStop(1, isDark ? 'rgba(255,59,48,0.02)' : 'rgba(255,59,48,0.02)');
    } else {
        grad.addColorStop(0, isDark ? 'rgba(52,199,89,0.30)' : 'rgba(52,199,89,0.18)');
        grad.addColorStop(1, isDark ? 'rgba(52,199,89,0.02)' : 'rgba(52,199,89,0.02)');
    }

    // 布林通道帶狀填充（畫在最底層）
    var bbStart = -1;
    for (var i = 0; i < n; i++) { if (bbUpper[i] != null && bbLower[i] != null) { bbStart = i; break; } }
    if (bbStart >= 0) {
        ctx.beginPath();
        ctx.moveTo(xOf(bbStart), yOf(bbUpper[bbStart]));
        for (var i = bbStart + 1; i < n; i++) {
            if (bbUpper[i] != null) ctx.lineTo(xOf(i), yOf(bbUpper[i]));
        }
        for (var i = n - 1; i >= bbStart; i--) {
            if (bbLower[i] != null) ctx.lineTo(xOf(i), yOf(bbLower[i]));
        }
        ctx.closePath();
        ctx.fillStyle = isDark ? 'rgba(90,169,255,0.08)' : 'rgba(0,113,227,0.06)';
        ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(close[0]));
    for (var i = 1; i < n; i++) ctx.lineTo(xOf(i), yOf(close[i]));
    ctx.lineTo(xOf(n - 1), priceH);
    ctx.lineTo(xOf(0), priceH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 收盤價線
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(close[0]));
    for (var i = 1; i < n; i++) ctx.lineTo(xOf(i), yOf(close[i]));
    ctx.strokeStyle = close[n - 1] >= close[0]
        ? (isDark ? '#ff3b30' : '#e03328')
        : (isDark ? '#34c759' : '#28a745');
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // MA 均線
    function drawMA(data, color) {
        ctx.beginPath();
        var started = false;
        for (var i = 0; i < data.length; i++) {
            if (data[i] == null) continue;
            if (!started) { ctx.moveTo(xOf(i), yOf(data[i])); started = true; }
            else ctx.lineTo(xOf(i), yOf(data[i]));
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    drawMA(ma20, isDark ? '#5aa9ff' : '#0071e3');
    drawMA(ma60, isDark ? '#ff9f0a' : '#e68600');
    drawMA(ma120, isDark ? '#bf5af2' : '#9b38d9');

    // 布林通道上下軌（虛線）
    var bbColor = isDark ? 'rgba(90,169,255,0.35)' : 'rgba(0,113,227,0.25)';
    ctx.setLineDash([3, 3]);
    drawMA(bbUpper, bbColor);
    drawMA(bbLower, bbColor);
    ctx.setLineDash([]);

    // 均價虛線
    if (d.avg) {
        var avgY = yOf(d.avg);
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, avgY);
        ctx.lineTo(W, avgY);
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 儲存幾何資訊供 hover 用
    var safeId = ticker.replace(/\./g, '_');
    chartGeo[safeId] = { ticker: ticker, W: W, H: H, n: n, priceH: priceH, padTop: padTop, pMin: pMin, pRange: pRange, dpr: dpr };
    _bindChartHover(safeId);
}

/* ═══════ CHART HOVER / CROSSHAIR ═══════ */

var chartGeo = {};

function _fmtVol(v) {
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v;
}

function _bindChartHover(safeId) {
    var wrap = document.getElementById('chartWrap_' + safeId);
    if (!wrap) return;
    if (wrap._hoverBound) return;
    wrap._hoverBound = true;

    var overlay = document.getElementById('chartOverlay_' + safeId);
    if (!overlay) return;

    function onMove(clientX) {
        var geo = chartGeo[safeId];
        if (!geo) return;
        var rect = wrap.getBoundingClientRect();
        var x = clientX - rect.left;
        var idx = Math.round(x / geo.W * (geo.n - 1));
        idx = Math.max(0, Math.min(geo.n - 1, idx));
        _drawCrosshair(safeId, idx);
        _updateHoverInfo(safeId, idx);
    }

    wrap.addEventListener('mousemove', function(e) { onMove(e.clientX); });
    wrap.addEventListener('mouseleave', function() { _clearCrosshair(safeId); _hideHoverInfo(safeId); });
    wrap.addEventListener('touchmove', function(e) {
        e.preventDefault();
        if (e.touches.length) onMove(e.touches[0].clientX);
    }, { passive: false });
    wrap.addEventListener('touchend', function() { _clearCrosshair(safeId); _hideHoverInfo(safeId); });
}

function _drawCrosshair(safeId, idx) {
    var geo = chartGeo[safeId];
    if (!geo) return;
    var overlay = document.getElementById('chartOverlay_' + safeId);
    if (!overlay) return;

    var dpr = geo.dpr;
    var W = geo.W, H = geo.H;
    overlay.width = W * dpr;
    overlay.height = H * dpr;
    var ctx = overlay.getContext('2d');
    ctx.scale(dpr, dpr);

    var range = chartRange[geo.ticker] || '3m';
    var d = chartCache[geo.ticker + ':' + range];
    if (!d || !d.close) return;

    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var xPos = (idx / (geo.n - 1)) * W;
    var yPos = geo.padTop + (1 - (d.close[idx] - geo.pMin) / geo.pRange) * (geo.priceH - geo.padTop);

    // 垂直虛線
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(xPos, 0);
    ctx.lineTo(xPos, H);
    ctx.strokeStyle = isDark ? 'rgba(90,169,255,0.5)' : 'rgba(0,113,227,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // 價格圓點
    ctx.beginPath();
    ctx.arc(xPos, yPos, 4, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? '#5aa9ff' : '#0071e3';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(xPos, yPos, 2, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? '#000' : '#fff';
    ctx.fill();
}

function _clearCrosshair(safeId) {
    var overlay = document.getElementById('chartOverlay_' + safeId);
    if (!overlay) return;
    var ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
}

function _updateHoverInfo(safeId, idx) {
    var geo = chartGeo[safeId];
    if (!geo) return;
    var el = document.getElementById('chartHover_' + safeId);
    if (!el) return;
    var range = chartRange[geo.ticker] || '3m';
    var d = chartCache[geo.ticker + ':' + range];
    if (!d || !d.close) return;

    var price = d.close[idx];
    var prevPrice = idx > 0 ? d.close[idx - 1] : price;
    var chg = price - prevPrice;
    var chgPct = prevPrice ? ((chg / prevPrice) * 100) : 0;
    var isUp = chg >= 0;
    var chgClass = isUp ? 'price-up' : 'price-down';
    var arrow = isUp ? '+' : '';
    var date = d.dates[idx] || '';
    var vol = (d.volume && d.volume[idx]) ? d.volume[idx] : 0;
    var ma20v = (d.ma20 && d.ma20[idx] != null) ? d.ma20[idx] : null;
    var ma60v = (d.ma60 && d.ma60[idx] != null) ? d.ma60[idx] : null;
    var ma120v = (d.ma120 && d.ma120[idx] != null) ? d.ma120[idx] : null;
    var bbUv = (d.bb_upper && d.bb_upper[idx] != null) ? d.bb_upper[idx] : null;
    var bbLv = (d.bb_lower && d.bb_lower[idx] != null) ? d.bb_lower[idx] : null;

    var tk = geo.ticker;
    var html = '<span class="hover-date">' + date + '</span> '
        + '<span class="' + chgClass + '">' + _fmtPrice(price, tk) + '</span> '
        + '<span class="' + chgClass + '">' + arrow + _fmtNum(chg, tk) + '</span> '
        + '<span class="' + chgClass + '">' + arrow + chgPct.toFixed(2) + '%</span>';
    if (d.avg != null) html += ' <span class="hover-avg">Avg:' + _fmtPrice(d.avg, tk) + '</span>';
    if (vol) html += ' <span class="hover-vol">Vol:' + _fmtVol(vol) + '</span>';

    el.innerHTML = html;
    el.classList.remove('hover-idle');

    var maEl = el.parentElement.querySelector('.chart-ma-legend');
    if (maEl) maEl.innerHTML = _maLegendHtml(ma20v, ma60v, ma120v, bbUv, bbLv, tk);
}

function _hideHoverInfo(safeId) {
    var el = document.getElementById('chartHover_' + safeId);
    if (el) el.classList.add('hover-idle');

    // 恢復 MA 圖例到最新值
    var geo = chartGeo[safeId];
    if (!geo) return;
    var range = chartRange[geo.ticker] || '3m';
    var d = chartCache[geo.ticker + ':' + range];
    if (!d) return;
    var maEl = el.parentElement.querySelector('.chart-ma-legend');
    if (maEl) maEl.innerHTML = _maLegendHtml(_lastNonNull(d.ma20), _lastNonNull(d.ma60), _lastNonNull(d.ma120), _lastNonNull(d.bb_upper), _lastNonNull(d.bb_lower));
}

function updateHeroCaption() {
    const el = document.getElementById('heroCaption');
    if (!el) return;
    if (!stocks.length) {
        el.textContent = '搜尋並新增股票開始追蹤';
        return;
    }
    const marketState = stocks[0] ? getMarketStateText(stocks[0].market_state) : '';
    el.textContent = stocks.length + ' 檔股票' + (marketState ? ' · ' + marketState : '');
}


/* ═══════ RENDER SETTINGS STOCK LIST ═══════ */

function renderSettingsStockList() {
    const container = document.getElementById('settingsStockList');
    if (!container) return;
    container.innerHTML = '';

    const titleEl = document.getElementById('settingsListTitle');
    const current = typeof getCurrentWatchlist === 'function' ? getCurrentWatchlist() : null;
    if (titleEl) titleEl.textContent = current ? current.name : '自選股';

    stocks.forEach((stock, index) => {
        const row = document.createElement('div');
        row.className = 'settings-row';
        row.dataset.index = index;

        row.innerHTML = `
            ${tileHtml(stock)}
            <div class="row-info">
                <div class="ty-row">${stock.ticker}</div>
                <div class="ty-subtitle">${(stock.company_name && stock.company_name !== stock.ticker) ? stock.company_name : ''}</div>
            </div>
            <div class="drag-handle">${SVG_DRAG}</div>
            <button type="button" class="delete-btn" data-ticker="${stock.ticker}">
                ${SVG_DELETE}
            </button>`;

        row.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeStock(e.currentTarget.dataset.ticker);
        });

        const handle = row.querySelector('.drag-handle');
        attachDragHandlers(handle, {
            containerId: 'settingsStockList',
            rowSelector: '.settings-row',
            onReorder: (from, to) => {
                const item = stocks[from];
                stocks.splice(from, 1);
                stocks.splice(to, 0, item);
                renderSettingsStockList();
                renderStocks();
                updateStockOrder();
            },
        });

        container.appendChild(row);
    });
}


/* ═══════ STOCK CRUD ═══════ */

async function removeStock(ticker) {
    try {
        const userInfo = JSON.parse(localStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) throw new Error('找不到使用者資訊');

        const response = await authFetch(
            '/watchlists/' + currentWatchlistId + '/stocks/' + encodeURIComponent(ticker),
            { method: 'DELETE' }
        );
        if (!response.ok) throw new Error('移除股票失敗');

        const idx = stocks.findIndex(s => s.ticker === ticker);
        if (idx >= 0) {
            stocks.splice(idx, 1);
            renderSettingsStockList();
            renderStocks();
            const list = watchlists.find(w => w.id === currentWatchlistId);
            if (list) list.count = stocks.length;
        }
    } catch (error) {
        console.error('移除股票時發生錯誤:', error);
    }
}


/* ═══════ TOUCH DRAG ═══════ */

// 把拖曳行為綁到把手上。ctx 描述「拖的是哪個清單」，讓設定頁與清單抽屜共用同一套邏輯。
// ctx = { containerId, rowSelector, onReorder(fromIndex, toIndex) }
function attachDragHandlers(handle, ctx) {
    handle._dragCtx = ctx;
    handle.addEventListener('touchstart', handleTouchStart, { passive: false });
    handle.addEventListener('touchmove', handleTouchMove, { passive: false });
    handle.addEventListener('touchend', handleTouchEnd);
    handle.addEventListener('mousedown', handleMouseDown);
}

function handleTouchStart(e) {
    e.preventDefault();
    e.stopPropagation();

    const touch = e.touches[0];
    const handle = e.target.closest('.drag-handle');
    if (!handle || !handle._dragCtx) return;

    dragCtx = handle._dragCtx;
    const item = handle.closest(dragCtx.rowSelector);
    if (!item) return;

    touchStartY = touch.clientY;
    currentTouchItem = item;
    draggedItemIndex = parseInt(item.dataset.index);

    item.style.position = 'relative';
    item.style.zIndex = '1000';
    item.classList.add('touch-dragging');

    const items = document.getElementById(dragCtx.containerId).querySelectorAll(dragCtx.rowSelector);
    items.forEach(i => {
        if (i !== item) i.style.transition = 'transform 0.3s ease';
    });
}

function handleTouchMove(e) {
    if (!currentTouchItem || touchStartY === null) return;
    e.preventDefault();
    e.stopPropagation();

    const touch = e.touches[0];
    const moveY = touch.clientY - touchStartY;
    currentTouchItem.style.transform = 'translateY(' + moveY + 'px)';

    const container = document.getElementById(dragCtx.containerId);
    const items = Array.from(container.querySelectorAll(dragCtx.rowSelector));
    const itemHeight = currentTouchItem.offsetHeight;
    const currentIndex = items.indexOf(currentTouchItem);
    const targetIndex = Math.round(moveY / itemHeight) + currentIndex;
    const boundedIndex = Math.max(0, Math.min(targetIndex, items.length - 1));

    items.forEach((item, index) => {
        if (item === currentTouchItem) return;
        if (boundedIndex > currentIndex && index > currentIndex && index <= boundedIndex) {
            item.style.transform = 'translateY(' + (-itemHeight) + 'px)';
        } else if (boundedIndex < currentIndex && index < currentIndex && index >= boundedIndex) {
            item.style.transform = 'translateY(' + itemHeight + 'px)';
        } else {
            item.style.transform = '';
        }
    });
}

function handleTouchEnd() {
    if (!currentTouchItem) return;

    const container = document.getElementById(dragCtx.containerId);
    const items = Array.from(container.querySelectorAll(dragCtx.rowSelector));
    const currentIndex = items.indexOf(currentTouchItem);
    const raw = currentTouchItem.style.transform;
    const moveY = parseFloat(raw.replace('translateY(', '').replace('px)', '') || 0);
    const itemHeight = currentTouchItem.offsetHeight;
    const targetIndex = Math.round(moveY / itemHeight) + currentIndex;
    const boundedIndex = Math.max(0, Math.min(targetIndex, items.length - 1));

    // 先清掉拖曳中的樣式，再交給 onReorder 重繪（重繪會換掉整批 DOM）
    currentTouchItem.style.position = '';
    currentTouchItem.style.zIndex = '';
    currentTouchItem.style.transform = '';
    currentTouchItem.classList.remove('touch-dragging');

    if (boundedIndex !== currentIndex) {
        dragCtx.onReorder(currentIndex, boundedIndex);
    } else {
        items.forEach(item => { item.style.transform = ''; item.style.transition = ''; });
    }

    currentTouchItem = null;
    touchStartY = null;
    draggedItemIndex = null;
    dragCtx = null;
}


/* ═══════ MOUSE DRAG ═══════ */

function handleMouseDown(e) {
    e.preventDefault();
    const handle = e.target.closest('.drag-handle');
    if (!handle || !handle._dragCtx) return;

    dragCtx = handle._dragCtx;
    const item = handle.closest(dragCtx.rowSelector);
    if (!item) return;

    const startY = e.clientY;
    const ctx = dragCtx;              // 閉包內固定用這份，避免拖曳中被其他把手覆寫
    currentTouchItem = item;
    draggedItemIndex = parseInt(item.dataset.index);

    item.style.position = 'relative';
    item.style.zIndex = '1000';
    item.classList.add('touch-dragging');

    const container = document.getElementById(ctx.containerId);
    const items = Array.from(container.querySelectorAll(ctx.rowSelector));
    items.forEach(i => {
        if (i !== item) i.style.transition = 'transform 0.3s ease';
    });

    function onMouseMove(ev) {
        if (!currentTouchItem) return;
        const moveY = ev.clientY - startY;
        currentTouchItem.style.transform = 'translateY(' + moveY + 'px)';

        const itemHeight = currentTouchItem.offsetHeight;
        const currentIndex = items.indexOf(currentTouchItem);
        const targetIndex = Math.round(moveY / itemHeight) + currentIndex;
        const boundedIndex = Math.max(0, Math.min(targetIndex, items.length - 1));

        items.forEach((it, index) => {
            if (it === currentTouchItem) return;
            if (boundedIndex > currentIndex && index > currentIndex && index <= boundedIndex) {
                it.style.transform = 'translateY(' + (-itemHeight) + 'px)';
            } else if (boundedIndex < currentIndex && index < currentIndex && index >= boundedIndex) {
                it.style.transform = 'translateY(' + itemHeight + 'px)';
            } else {
                it.style.transform = '';
            }
        });
    }

    function onMouseUp(ev) {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        if (!currentTouchItem) return;

        const moveY = ev.clientY - startY;
        const itemHeight = currentTouchItem.offsetHeight;
        const currentIndex = items.indexOf(currentTouchItem);
        const targetIndex = Math.round(moveY / itemHeight) + currentIndex;
        const boundedIndex = Math.max(0, Math.min(targetIndex, items.length - 1));

        currentTouchItem.style.position = '';
        currentTouchItem.style.zIndex = '';
        currentTouchItem.style.transform = '';
        currentTouchItem.classList.remove('touch-dragging');

        if (boundedIndex !== currentIndex) {
            ctx.onReorder(currentIndex, boundedIndex);
        } else {
            items.forEach(it => { it.style.transform = ''; it.style.transition = ''; });
        }

        currentTouchItem = null;
        draggedItemIndex = null;
        dragCtx = null;
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}


/* ═══════ STOCK ORDER ═══════ */

async function updateStockOrder() {
    try {
        const userInfo = JSON.parse(localStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) return;

        await authFetch('/watchlists/' + currentWatchlistId + '/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tickers: stocks.map(s => s.ticker) })
        });
    } catch (error) {
        console.error('更新股票順序時發生錯誤:', error);
    }
}


/* ═══════ PRICE UPDATE ═══════ */

async function fetchStockPrice(ticker) {
    try {
        const response = await authFetch('/stockprice/' + ticker);
        const data = await response.json();
        return data.error ? null : data;
    } catch (error) {
        console.error('Error fetching price for ' + ticker + ':', error);
        return null;
    }
}

let pollTimer = null;

function getPollingInterval() {
    if (!stocks || !stocks.length) return 10000;
    const states = stocks.map(s => s.market_state || '');
    if (states.some(s => s === 'REGULAR')) return 5000;
    if (states.some(s => s === 'PRE' || s === 'POST')) return 15000;
    return 300000;
}

function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
        await updateStockPrices();
        schedulePoll();
    }, getPollingInterval());
}

async function updateStockPrices() {
    if (!stocks || !stocks.length) return;

    try {
        const prev = {};
        stocks.forEach(s => { prev[s.ticker] = s.price; });

        const updated = await Promise.all(stocks.map(async (stock) => {
            try {
                const response = await authFetch('/stockprice/' + stock.ticker, { cache: 'no-store' });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.json();
                if (data.error) return stock;
                return {
                    ...stock,
                    ...data,
                    company_name: data.company_name || stock.company_name,
                    logo_url: data.logo_url || stock.logo_url,
                };
            } catch {
                return stock;
            }
        }));

        // 標記價格有變動的股票，讓 renderStocks 做一次微閃爍
        priceFlash = {};
        updated.forEach(s => {
            const before = prev[s.ticker];
            if (before != null && typeof s.price === 'number' && s.price !== before) {
                priceFlash[s.ticker] = s.price > before ? 'up' : 'down';
            }
        });

        stocks = updated;
        renderStocks();
        updateLastUpdateTime();
    } catch (error) {
        console.error('更新股票價格時發生錯誤:', error);
    }
}


/* ═══════ TIME ═══════ */

function updateLastUpdateTime() {
    const el = document.getElementById('lastUpdateTime');
    if (!el) return;
    // 只在實際刷新時更新，顯示到分（不再每秒跳動）
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    el.textContent = '更新 ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
}


/* ═══════ INIT ═══════ */

// 抓目前清單的股票並重繪（切換清單、初始化都走這裡）
async function loadCurrentWatchlistStocks() {
    const email = getCurrentUserEmail();
    if (!email || !currentWatchlistId) { stocks = []; renderStocks(); return; }

    const requestedWatchlistId = currentWatchlistId; // 記住這次請求對應的清單，避免舊回應蓋掉新清單
    expandedTicker = null;   // 換清單時收合展開中的個股
    renderSkeleton();

    const response = await authFetch('/watchlists/' + requestedWatchlistId + '/stocks');
    if (!response.ok) throw new Error('獲取股票數據失敗');

    const data = await response.json();
    if (currentWatchlistId !== requestedWatchlistId) return; // 已切到別的清單，這筆回應過期了

    stocks = data;
    renderStocks();
    renderSettingsStockList();
    updateStockPrices();
    schedulePoll();
    updateLastUpdateTime();
}

async function initializeStocks() {
    renderSkeleton(); // 資料抵達前先顯示骨架
    try {
        await loadWatchlists();
        await loadCurrentWatchlistStocks();
    } catch (error) {
        // 看盤 App 絕不能在抓不到資料時拿寫死的假股價頂替——那比報錯危險得多，
        // 使用者會把虛構的價格當成真的。載入失敗就明講，並提供重試。
        console.error('初始化股票數據時發生錯誤:', error);
        stocks = [];
        renderLoadError();
    }
}

// 載入失敗的明確狀態（取代過去偷偷塞 demo 資料的做法）
function renderLoadError() {
    const stockList = document.getElementById('stockList');
    if (!stockList) return;
    stockList.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">${SVG_EMPTY}</div>
            <div class="empty-state-title">載入失敗</div>
            <div class="empty-state-desc">無法取得你的自選股資料</div>
            <button class="pill-btn pill-btn-primary" style="margin-top:14px"
                    onclick="initializeStocks()">重試</button>
        </div>`;
    const card = document.getElementById('stockListCard');
    if (card) card.style.display = '';
    const settingsList = document.getElementById('settingsStockList');
    if (settingsList) settingsList.innerHTML = '';
}

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    // AI 對話未開放時，收起 nav 的對話鈕（面板本身預設就是 hidden）
    if (!AI_CHAT_ENABLED) {
        const chatBtn = document.getElementById('navChatBtn');
        if (chatBtn) chatBtn.classList.add('hidden');
    }
    initializeStocks();
    renderMarketClock();
    setInterval(renderMarketClock, 1000);

    // 記下目前前端版本，之後每分鐘比對一次；後端換版就自動重載，避免舊分頁打到已移除的端點
    checkAssetVersion();
    setInterval(checkAssetVersion, 60000);

    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    let searchTimeout;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (!query) { searchResults.classList.add('hidden'); return; }

        if (searchTimeout) clearTimeout(searchTimeout);

        searchTimeout = setTimeout(async () => {
            try {
                const response = await authFetch('/autocomplete/' + encodeURIComponent(query));
                if (!response.ok) throw new Error('搜尋失敗');
                const results = await response.json();

                searchResults.innerHTML = '';
                searchResults.classList.remove('hidden');

                if (!results.length) {
                    searchResults.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-tertiary);font:400 13px/1.30 var(--font)">找不到符合的股票</div>';
                    return;
                }

                results.forEach(stock => {
                    const item = document.createElement('div');
                    item.className = 'search-result-item';
                    item.onclick = () => {
                        document.getElementById('searchResults').classList.add('hidden');
                        document.getElementById('searchInput').value = '';
                        openListPicker(stock.symbol);
                    };
                    item.innerHTML = `
                        <div class="search-result-tile" style="background:${getTileGradient(stock.symbol)}">${stock.symbol[0]}</div>
                        <div class="search-result-info">
                            <div class="result-symbol">${stock.symbol}</div>
                            <div class="result-name">${stock.name}${stock.exchange ? ' (' + stock.exchange + ')' : ''}</div>
                        </div>
                        <div class="search-result-add">${SVG_ADD}</div>`;
                    searchResults.appendChild(item);
                });
            } catch (error) {
                console.error('搜尋時發生錯誤:', error);
                searchResults.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-tertiary);font:400 13px/1.30 var(--font)">搜尋時發生錯誤</div>';
            }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#searchInput') && !e.target.closest('#searchResults') && !e.target.closest('.search-field')) {
            searchResults.classList.add('hidden');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeWatchlistDrawer();
    });
});


/* ═══════ CHAT ═══════ */

async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const chatMessages = document.getElementById('chatMessages');
    const message = messageInput.value.trim();
    if (!message) return;

    const emptyState = chatMessages.querySelector('.chat-empty');
    if (emptyState) emptyState.remove();

    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble chat-bubble-user';
    userBubble.textContent = message;
    chatMessages.appendChild(userBubble);

    messageInput.value = '';

    const loadingBubble = document.createElement('div');
    loadingBubble.className = 'chat-bubble chat-bubble-ai';
    loadingBubble.innerHTML = '<div class="chat-loading"><span></span><span></span><span></span></div>';
    chatMessages.appendChild(loadingBubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                ticker: chatContext ? chatContext.ticker : null,
                context: chatContext ? chatContext.summary : null
            })
        });

        const data = await response.json();
        const aiBubble = document.createElement('div');
        aiBubble.className = 'chat-bubble chat-bubble-ai';
        aiBubble.innerHTML = '<div class="markdown-content">' + marked.parse(data.response.trim()) + '</div>';
        chatMessages.appendChild(aiBubble);
    } catch {
        const errBubble = document.createElement('div');
        errBubble.className = 'chat-bubble chat-bubble-ai';
        errBubble.textContent = '發生錯誤，請稍後再試';
        chatMessages.appendChild(errBubble);
    } finally {
        if (loadingBubble.parentNode === chatMessages) chatMessages.removeChild(loadingBubble);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}


/* ═══════ SWIPE TO SWITCH WATCHLIST ═══════ */

(function() {
    var swipeStartX = 0, swipeStartY = 0, swiping = false, swipeLocked = false;
    var THRESHOLD = 50;

    document.addEventListener('DOMContentLoaded', function() {
        var el = document.querySelector('.page-content');
        if (!el) return;

        el.addEventListener('touchstart', function(e) {
            if (e.target.closest('.drag-handle, .chart-canvas-wrap, .chart-overlay-canvas, .chart-range-btn')) return;
            swipeStartX = e.touches[0].clientX;
            swipeStartY = e.touches[0].clientY;
            swiping = true;
            swipeLocked = false;
        }, { passive: true });

        el.addEventListener('touchmove', function(e) {
            if (!swiping) return;
            var dx = e.touches[0].clientX - swipeStartX;
            var dy = e.touches[0].clientY - swipeStartY;
            if (!swipeLocked && Math.abs(dy) > Math.abs(dx)) { swiping = false; }
            swipeLocked = true;
        }, { passive: true });

        el.addEventListener('touchend', function(e) {
            if (!swiping) return;
            swiping = false;
            var dx = e.changedTouches[0].clientX - swipeStartX;
            if (Math.abs(dx) < THRESHOLD) return;
            var direction = dx < 0 ? 1 : -1;
            var nextId = getAdjacentWatchlistId(direction);
            if (nextId == null) return;
            slideToWatchlist(nextId, direction);
        });
    });
})();

function slideToWatchlist(id, direction) {
    var card = document.getElementById('stockListCard');
    if (!card) { switchWatchlist(id); return; }

    var outClass = direction > 0 ? 'slide-out-left' : 'slide-out-right';
    var inClass  = direction > 0 ? 'slide-in-right' : 'slide-in-left';

    card.classList.add(outClass);
    card.addEventListener('transitionend', function handler() {
        card.removeEventListener('transitionend', handler);
        currentWatchlistId = id;
        collapsedGroups = {};
        localStorage.setItem(LS_CURRENT_WATCHLIST, id);
        updateNavWatchlistName();

        card.classList.remove(outClass);
        card.classList.add(inClass);
        loadCurrentWatchlistStocks().finally(function() {
            requestAnimationFrame(function() {
                card.classList.remove(inClass);
            });
        });
    }, { once: true });
}


/* ═══════ TOAST ═══════ */

function showToast(message) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => { toast.classList.add('visible'); });

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => { if (toast.parentNode) container.removeChild(toast); }, 300);
    }, 3000);
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
