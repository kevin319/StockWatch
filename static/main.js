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
let expandAnimate = false;    // 一次性：本次重繪是否播放展開動畫
let chatContext = null;       // 從股票開啟聊天時的脈絡 {ticker, summary}；一般聊天為 null

function initStockData() {
    stocks = [
        { ticker: 'CWEB', company_name: 'Direxion Daily CSI China Internet Bull 2X', price: 43.63, prev_close: 44.50, price_change: -0.87, price_change_percent: -1.96, market_state: 'REGULAR', extended_price: 40.90, extended_type: 'PRE_MARKET', extended_change: -2.73, extended_change_percent: -6.25 },
        { ticker: 'PLTR', company_name: 'Palantir Technologies Inc.', price: 24.77, prev_close: 25.20, price_change: -0.43, price_change_percent: -1.71, market_state: 'REGULAR', extended_price: 0, extended_type: '', extended_change: 0, extended_change_percent: 0 },
        { ticker: '2330.TW', company_name: '台灣積體電路製造股份有限公司', price: 2390.0, prev_close: 2340.0, price_change: 50.0, price_change_percent: 2.14, market_state: 'REGULAR', extended_price: 0, extended_type: '', extended_change: 0, extended_change_percent: 0 },
    ];
    return stocks;
}


/* ═══════ UI TOGGLES ═══════ */

function toggleChatWindow() {
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

    stocks.forEach((stock, index) => {
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
                <span class="price-main">${stock.price.toFixed(2)}</span>
                ${hasExtended ? `<span class="ext-price">${extLabel} ${stock.extended_price.toFixed(2)}</span>` : ''}
            </div>
            <div class="row-change">
                <span class="price-change ${changeClass}">${arrow}${stock.price_change_percent.toFixed(2)}%</span>
                ${hasExtended
                    ? `<span class="ext-change ${extClass}">${extArrow}${stock.extended_change_percent.toFixed(2)}%</span>`
                    : `<span class="ext-change ${changeClass}">${arrow}${stock.price_change.toFixed(2)}</span>`}
            </div>`;
        row.addEventListener('click', () => toggleExpand(stock.ticker));
        item.appendChild(row);

        if (isExpanded) {
            const detail = document.createElement('div');
            detail.className = 'stock-detail' + (expandAnimate ? ' detail-enter' : '');
            detail.innerHTML = detailHtml(stock.ticker);
            item.appendChild(detail);
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
    if (!(ticker in summaryData)) loadSummary(ticker);
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
        const res = await fetch('/fundamentals/' + ticker);
        fundData[ticker] = await res.json();
    } catch {
        fundData[ticker] = { error: true };
    }
    // 只換面板內容、不重建元素，避免打斷展開動畫
    if (expandedTicker === ticker) {
        const detail = document.querySelector('.stock-detail');
        if (detail) detail.innerHTML = detailHtml(ticker);
        else renderStocks();
    }
}

// AI 摘要懶載入：抓 /ai-summary/{ticker}，失敗存空字串。
// 完成後只就地更新目前展開的 .stock-detail（沿用 loadFundamentals 手法）。
async function loadSummary(ticker) {
    summaryData[ticker] = 'loading';
    try {
        const res = await fetch('/ai-summary/' + ticker);
        const data = await res.json();
        summaryData[ticker] = data.summary || '';
    } catch {
        summaryData[ticker] = '';
    }
    if (expandedTicker === ticker) {
        const detail = document.querySelector('.stock-detail');
        if (detail) detail.innerHTML = detailHtml(ticker);
        else renderStocks();
    }
}

// 展開面板 HTML：基本面 grid + AI 摘要區
function detailHtml(ticker) {
    return fundamentalsHtml(ticker) + summaryHtml(ticker);
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
    ];
    return `<div class="detail-grid">${cells.map(([k, v]) =>
        `<div class="metric"><div class="metric-label">${k}</div><div class="metric-value">${v}</div></div>`).join('')}</div>`
        + week52RangeHtml(ticker, d);
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
        <div class="range52-ends"><span>${lo.toFixed(2)}</span><span>${hi.toFixed(2)}</span></div>
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
    return `<div class="summary-section">
        <div class="summary-head">
            <span class="summary-title">AI 摘要</span>
            <button class="summary-chat-btn" aria-label="與 AI 討論這檔股票"
                    onclick="event.stopPropagation(); openStockChat('${ticker}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>問 AI
            </button>
        </div>
        ${body}
        <div class="summary-disclaimer">AI 生成，僅供參考</div>
    </div>`;
}

// 從股票面板開啟聊天：帶入脈絡並切換到聊天視窗
function openStockChat(ticker) {
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

        const response = await fetch(
            '/watchlists/' + currentWatchlistId + '/stocks/' + encodeURIComponent(ticker)
            + '?user_email=' + encodeURIComponent(userInfo.email),
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

async function addToWatchlist(ticker) {
    try {
        if (stocks.some(s => s.ticker === ticker)) {
            throw new Error('此股票已在清單中');
        }

        const userInfo = JSON.parse(localStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) throw new Error('找不到使用者資訊');

        const response = await fetch('/watchlist/add?ticker=' + ticker + '&user_email=' + userInfo.email, { method: 'POST' });
        if (!response.ok) throw new Error('新增股票失敗');

        const stockResponse = await fetch('/stockprice/' + ticker);
        if (!stockResponse.ok) throw new Error('取得股票資訊失敗');
        const stockData = await stockResponse.json();

        stocks.push(stockData);
        renderSettingsStockList();
        renderStocks();

        document.getElementById('searchResults').classList.add('hidden');
        document.getElementById('searchInput').value = '';
    } catch (error) {
        console.error('新增股票時發生錯誤:', error);
        showToast(error.message);
        document.getElementById('searchInput').value = '';
        document.getElementById('searchResults').classList.add('hidden');
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

        await fetch('/watchlists/' + currentWatchlistId + '/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_email: userInfo.email, tickers: stocks.map(s => s.ticker) })
        });
    } catch (error) {
        console.error('更新股票順序時發生錯誤:', error);
    }
}


/* ═══════ PRICE UPDATE ═══════ */

async function fetchStockPrice(ticker) {
    try {
        const response = await fetch('/stockprice/' + ticker);
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
    if (states.some(s => s === 'REGULAR')) return 10000;
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
                const response = await fetch('/stockprice/' + stock.ticker, { cache: 'no-store' });
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

    const response = await fetch(
        '/watchlists/' + requestedWatchlistId + '/stocks?user_email=' + encodeURIComponent(email)
    );
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
        console.error('初始化股票數據時發生錯誤:', error);
        stocks = initStockData();
        renderStocks();
        renderSettingsStockList();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    initializeStocks();
    renderMarketClock();
    setInterval(renderMarketClock, 1000);

    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    let searchTimeout;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (!query) { searchResults.classList.add('hidden'); return; }

        if (searchTimeout) clearTimeout(searchTimeout);

        searchTimeout = setTimeout(async () => {
            try {
                const response = await fetch('/autocomplete/' + encodeURIComponent(query));
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
                    item.onclick = () => addToWatchlist(stock.symbol);
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
