/* ═══════ THEME ═══════ */

function loadTheme() {
    var saved = localStorage.getItem('sw-theme') || 'light';
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
let sparkData = {}; // ticker -> 近期收盤序列
let priceFlash = {}; // ticker -> 'up'|'down'，本次更新價格變動方向（供微閃爍）

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
    el.classList.toggle('hidden');
}

function toggleSettingsPage() {
    const el = document.getElementById('settingsPage');
    if (!el) return;
    el.classList.toggle('hidden');
    if (!el.classList.contains('hidden')) {
        updateThemeToggle(localStorage.getItem('sw-theme') || 'light');
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

function getMarketDotClass(state) {
    if (state === 'REGULAR') return 'market-dot-live';
    if (state === 'PRE') return 'market-dot-pre';
    return 'market-dot-close';
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

function formatCountdown(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
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
    if (summary) summary.textContent = openCount + ' / 4 開盤';
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

// 由收盤序列產生迷你走勢圖 SVG，依區間淨變動上色（紅漲綠跌）
function sparklineSvg(points) {
    if (!points || points.length < 2) return '';
    const w = 54, h = 28, pad = 3;
    const min = Math.min(...points), max = Math.max(...points);
    const range = (max - min) || 1;
    const stepX = (w - pad * 2) / (points.length - 1);
    const coords = points.map((p, i) => {
        const x = pad + i * stepX;
        const y = pad + (h - pad * 2) * (1 - (p - min) / range);
        return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const up = points[points.length - 1] >= points[0];
    const color = up ? 'var(--negative)' : 'var(--positive)'; // 紅漲綠跌
    return `<svg class="spark-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${coords}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
}

function renderStocks() {
    const stockList = document.getElementById('stockList');
    stockList.innerHTML = '';

    if (!stocks.length) {
        stockList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">${SVG_EMPTY}</div>
                <div class="empty-state-title">尚未追蹤任何股票</div>
                <div class="empty-state-desc">使用下方搜尋列新增股票到自選清單</div>
            </div>`;
        document.getElementById('stockListCard').style.display = '';
        updateHeroCaption();
        return;
    }

    stocks.forEach((stock) => {
        const up = stock.price_change >= 0;
        const changeClass = up ? 'price-up' : 'price-down';
        const arrow = up ? '+' : '';
        const hasExtended = stock.extended_price && stock.extended_price > 0;
        const extUp = stock.extended_change >= 0;
        const extClass = extUp ? 'price-up' : 'price-down';
        const extArrow = extUp ? '+' : '';
        const extLabel = stock.extended_type === 'PRE_MARKET' ? '盤前' : '盤後';
        const dotClass = getMarketDotClass(stock.market_state);

        const row = document.createElement('div');
        const flashDir = priceFlash[stock.ticker];
        row.className = 'v2-row' + (flashDir ? ' flash-' + flashDir : '');
        row.innerHTML = `
            ${tileHtml(stock)}
            <div class="row-info">
                <div class="ty-row">
                    <span class="market-dot ${dotClass}"></span>${stock.ticker}
                </div>
                <div class="ty-subtitle">${stock.company_name || stock.ticker}</div>
            </div>
            <div class="row-spark">${sparklineSvg(sparkData[stock.ticker])}</div>
            <div class="row-price">
                <span class="price-main">$${stock.price.toFixed(2)}</span>
                <span class="price-change ${changeClass}">${arrow}${stock.price_change_percent.toFixed(2)}%</span>
                ${hasExtended ? `
                <span class="price-extended">
                    ${extLabel} $${stock.extended_price.toFixed(2)}
                    <span class="ext-change ${extClass}">${extArrow}${stock.extended_change_percent.toFixed(2)}%</span>
                </span>` : ''}
            </div>`;
        stockList.appendChild(row);
    });

    priceFlash = {}; // 閃爍只觸發一次
    updateHeroCaption();
    updateLastUpdateTime();
}

// 載入各股票走勢序列（變動慢，每檔抓一次即可），完成後重繪
async function loadSparklines() {
    const targets = stocks.filter(s => !(s.ticker in sparkData));
    if (!targets.length) return;
    await Promise.all(targets.map(async (s) => {
        try {
            const res = await fetch('/sparkline/' + s.ticker);
            const data = await res.json();
            sparkData[s.ticker] = Array.isArray(data.points) ? data.points : [];
        } catch {
            sparkData[s.ticker] = [];
        }
    }));
    renderStocks();
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

    stocks.forEach((stock, index) => {
        const row = document.createElement('div');
        row.className = 'settings-row';
        row.dataset.index = index;

        row.innerHTML = `
            ${tileHtml(stock)}
            <div class="row-info">
                <div class="ty-row">${stock.ticker}</div>
                <div class="ty-subtitle">${stock.company_name || stock.ticker}</div>
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
        handle.addEventListener('touchstart', handleTouchStart, { passive: false });
        handle.addEventListener('touchmove', handleTouchMove, { passive: false });
        handle.addEventListener('touchend', handleTouchEnd);
        handle.addEventListener('mousedown', handleMouseDown);

        container.appendChild(row);
    });
}


/* ═══════ STOCK CRUD ═══════ */

async function removeStock(ticker) {
    try {
        const userInfo = JSON.parse(sessionStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) throw new Error('找不到使用者資訊');

        const response = await fetch('/watchlist/' + userInfo.email + '/' + ticker, { method: 'DELETE' });
        if (!response.ok) throw new Error('移除股票失敗');

        const idx = stocks.findIndex(s => s.ticker === ticker);
        if (idx >= 0) {
            stocks.splice(idx, 1);
            renderSettingsStockList();
            renderStocks();
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

        const userInfo = JSON.parse(sessionStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) throw new Error('找不到使用者資訊');

        const response = await fetch('/watchlist/add?ticker=' + ticker + '&user_email=' + userInfo.email, { method: 'POST' });
        if (!response.ok) throw new Error('新增股票失敗');

        const stockResponse = await fetch('/stockprice/' + ticker);
        if (!stockResponse.ok) throw new Error('取得股票資訊失敗');
        const stockData = await stockResponse.json();

        stocks.push(stockData);
        renderSettingsStockList();
        renderStocks();
        loadSparklines();

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

function handleTouchStart(e) {
    e.preventDefault();
    e.stopPropagation();

    const touch = e.touches[0];
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;

    const item = handle.closest('.settings-row');
    if (!item) return;

    touchStartY = touch.clientY;
    currentTouchItem = item;
    draggedItemIndex = parseInt(item.dataset.index);

    item.style.position = 'relative';
    item.style.zIndex = '1000';
    item.classList.add('touch-dragging');

    const items = document.querySelectorAll('.settings-row');
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

    const container = document.getElementById('settingsStockList');
    const items = Array.from(container.querySelectorAll('.settings-row'));
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

    const container = document.getElementById('settingsStockList');
    const items = Array.from(container.querySelectorAll('.settings-row'));
    const currentIndex = items.indexOf(currentTouchItem);
    const raw = currentTouchItem.style.transform;
    const moveY = parseFloat(raw.replace('translateY(', '').replace('px)', '') || 0);
    const itemHeight = currentTouchItem.offsetHeight;
    const targetIndex = Math.round(moveY / itemHeight) + currentIndex;
    const boundedIndex = Math.max(0, Math.min(targetIndex, items.length - 1));

    if (boundedIndex !== currentIndex) {
        const itemToMove = stocks[currentIndex];
        stocks.splice(currentIndex, 1);
        stocks.splice(boundedIndex, 0, itemToMove);
        renderSettingsStockList();
        renderStocks();
        updateStockOrder();
    } else {
        items.forEach(item => { item.style.transform = ''; item.style.transition = ''; });
    }

    currentTouchItem.style.position = '';
    currentTouchItem.style.zIndex = '';
    currentTouchItem.style.transform = '';
    currentTouchItem.classList.remove('touch-dragging');
    currentTouchItem = null;
    touchStartY = null;
    draggedItemIndex = null;
}


/* ═══════ MOUSE DRAG ═══════ */

function handleMouseDown(e) {
    e.preventDefault();
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;

    const item = handle.closest('.settings-row');
    if (!item) return;

    const startY = e.clientY;
    currentTouchItem = item;
    draggedItemIndex = parseInt(item.dataset.index);

    item.style.position = 'relative';
    item.style.zIndex = '1000';
    item.classList.add('touch-dragging');

    const container = document.getElementById('settingsStockList');
    const items = Array.from(container.querySelectorAll('.settings-row'));
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

        if (boundedIndex !== currentIndex) {
            const itemToMove = stocks[currentIndex];
            stocks.splice(currentIndex, 1);
            stocks.splice(boundedIndex, 0, itemToMove);
            renderSettingsStockList();
            renderStocks();
            updateStockOrder();
        } else {
            items.forEach(it => { it.style.transform = ''; it.style.transition = ''; });
        }

        currentTouchItem.style.position = '';
        currentTouchItem.style.zIndex = '';
        currentTouchItem.style.transform = '';
        currentTouchItem.classList.remove('touch-dragging');
        currentTouchItem = null;
        draggedItemIndex = null;
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}


/* ═══════ STOCK ORDER ═══════ */

async function updateStockOrder() {
    try {
        const userInfo = JSON.parse(sessionStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) return;

        await fetch('/watchlist/reorder', {
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
    if (states.some(s => s === 'PRE' || s === 'POST')) return 60000;
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

async function initializeStocks() {
    try {
        const userInfo = JSON.parse(sessionStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) throw new Error('找不到使用者資訊');

        const response = await fetch('/watchlist/' + userInfo.email);
        if (!response.ok) throw new Error('獲取股票數據失敗');

        const data = await response.json();
        stocks = Array.isArray(data) ? data : initStockData();

        renderStocks();
        renderSettingsStockList();
        loadSparklines();
        updateStockPrices();
        schedulePoll();
        updateLastUpdateTime();
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
});


/* ═══════ CHAT ═══════ */

async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const chatMessages = document.getElementById('chatMessages');
    const message = messageInput.value.trim();
    if (!message) return;

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
            body: JSON.stringify({ message })
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
