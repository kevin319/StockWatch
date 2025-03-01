// Tailwind 配置
tailwind.config = {
    theme: {
        extend: {
            colors: {
                primary: '#60A5FA',
                secondary: '#1E293B'
            },
            borderRadius: {
                'none': '0px',
                'sm': '4px',
                DEFAULT: '8px',
                'md': '12px',
                'lg': '16px',
                'xl': '20px',
                '2xl': '24px',
                '3xl': '32px',
                'full': '9999px',
                'button': '8px'
            }
        }
    }
};

// 股票數據
let stocks = [];

// 初始化股票數據
function initStockData() {
    // 測試數據，格式與 API 返回格式一致
    stocks = [
        {
            ticker: 'CWEB',
            price: 43.63,
            prev_close: 44.50,
            price_change: -0.87,
            price_change_percent: -1.96,
            market_state: 'REGULAR',
            extended_price: 40.90,
            extended_type: 'PRE_MARKET',
            extended_change: -2.73,
            extended_change_percent: -6.25
        },
        {
            ticker: 'KTEC',
            price: 17.40,
            prev_close: 17.80,
            price_change: -0.40,
            price_change_percent: -2.25,
            market_state: 'REGULAR',
            extended_price: 17.57,
            extended_type: 'PRE_MARKET',
            extended_change: 0.17,
            extended_change_percent: 0.98
        },
        {
            ticker: 'PLTR',
            price: 24.77,
            prev_close: 25.20,
            price_change: -0.43,
            price_change_percent: -1.71,
            market_state: 'REGULAR',
            extended_price: 0,
            extended_type: '',
            extended_change: 0,
            extended_change_percent: 0
        },
        {
            ticker: '2330.TW',
            price: 84.77,
            prev_close: 85.20,
            price_change: -0.43,
            price_change_percent: -0.51,
            market_state: 'REGULAR',
            extended_price: 83.74,
            extended_type: 'PRE_MARKET',
            extended_change: -1.03,
            extended_change_percent: -1.21
        }
    ];
    return stocks;
}

// UI 控制功能
function toggleMessageModal() {
    const modal = document.getElementById('messageModal');
    modal.classList.toggle('hidden');
}

function toggleChatWindow() {
    const chatWindow = document.getElementById('chatWindow');
    const mainContent = document.querySelector('main');
    chatWindow.classList.toggle('hidden');
    mainContent.classList.toggle('mt-[340px]');
    mainContent.classList.toggle('mt-14');
}

function toggleSettingsPage() {
    const settingsPage = document.getElementById('settingsPage');
    settingsPage.classList.toggle('hidden');
}

// 自選股清單管理
let watchlistStocks = [];

function removeStock(index) {
    watchlistStocks.splice(index, 1);
    renderWatchlist();
}

// 拖放功能
let draggedItemIndex = null;

function dragStart(e) {
    draggedItemIndex = e.target.dataset.index;
    e.target.classList.add('opacity-50');
}

function dragOver(e) {
    e.preventDefault();
}

function drop(e) {
    e.preventDefault();
    const dropIndex = e.target.closest('[data-index]').dataset.index;
    const itemToMove = watchlistStocks[draggedItemIndex];
    watchlistStocks.splice(draggedItemIndex, 1);
    watchlistStocks.splice(dropIndex, 0, itemToMove);
    renderWatchlist();
}

// 股票數據管理
async function fetchStockPrice(ticker) {
    try {
        const response = await fetch(`/stockprice/${ticker}`);
        const data = await response.json();
        if (data.error) {
            console.error(`Error for ${ticker}:`, data.error);
            return null;
        }
        return data;
    } catch (error) {
        console.error(`Error fetching price for ${ticker}:`, error);
        return null;
    }
}

// 更新股票 UI
function updateStockUI(stockElement, priceData) {
    if (!priceData) return;

    const priceElement = stockElement.querySelector('.price');
    const changeElement = stockElement.querySelector('.change');
    const preMarketElement = stockElement.querySelector('.premarket');

    if (priceElement) {
        priceElement.textContent = priceData.price.toFixed(2);
    }

    if (changeElement && priceData.premarket) {
        const change = ((priceData.price - priceData.premarket) / priceData.premarket * 100).toFixed(2);
        changeElement.textContent = `${change > 0 ? '+' : ''}${change}%`;
        changeElement.className = `text-sm ${change >= 0 ? 'price-up' : 'price-down'}`;
    }

    if (preMarketElement && priceData.premarket) {
        preMarketElement.textContent = `盤前: ${priceData.premarket.toFixed(2)}`;
    }
}

async function updateStockPrices() {
    if (!stocks || !stocks.length) return;
    
    try {
        // 更新每個股票的價格
        const updatedStocks = await Promise.all(stocks.map(async (stock) => {
            try {
                const response = await fetch(`/stock/${stock.ticker}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                if (data.error) {
                    console.error(`獲取 ${stock.ticker} 數據失敗:`, data.error);
                    return stock;
                }
                return data;
            } catch (error) {
                console.error(`更新 ${stock.ticker} 時發生錯誤:`, error);
                return stock;
            }
        }));
        
        // 更新全局股票數據
        stocks = updatedStocks;
        
        // 重新渲染股票列表
        renderStocks();
        
    } catch (error) {
        console.error('更新股票價格時發生錯誤:', error);
    }
}

// 渲染股票列表
function renderStocks() {
    const stockList = document.getElementById('stockList');
    if (!stockList || !stocks) return;

    stockList.innerHTML = stocks.map(stock => `
        <div class="stock-item p-4 rounded-lg bg-secondary" data-symbol="${stock.ticker}">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center overflow-hidden">
                        <span class="text-white font-medium">${stock.ticker[0]}</span>
                    </div>
                    <div>
                        <div class="font-medium">${stock.ticker}</div>
                        <div class="text-sm text-gray-400">
                            ${getMarketStateText(stock.market_state)}
                        </div>
                    </div>
                </div>
                <div class="text-right">
                    <div class="text-xl font-bold">
                        $${stock.price.toFixed(2)}
                    </div>
                    <div class="text-sm ${stock.price_change >= 0 ? 'text-green-500' : 'text-red-500'}">
                        ${stock.price_change >= 0 ? '+' : ''}${stock.price_change.toFixed(2)}
                        (${stock.price_change_percent.toFixed(2)}%)
                    </div>
                </div>
            </div>
            ${stock.extended_price ? `
                <div class="mt-2 text-sm text-right">
                    <span class="text-gray-400">${stock.extended_type === 'PRE_MARKET' ? '盤前' : '盤後'}</span>
                    <span class="${stock.extended_change >= 0 ? 'text-green-500' : 'text-red-500'}">
                        $${stock.extended_price.toFixed(2)}
                        ${stock.extended_change >= 0 ? '+' : ''}${stock.extended_change.toFixed(2)}
                        (${stock.extended_change_percent.toFixed(2)}%)
                    </span>
                </div>
            ` : ''}
        </div>
    `).join('');

    // 更新最後更新時間
    updateLastUpdateTime();
}

// 獲取市場狀態文字
function getMarketStateText(state) {
    const stateMap = {
        'PRE': '盤前交易',
        'REGULAR': '一般交易',
        'POST': '盤後交易',
        'POSTPOST': '盤後交易',
        'CLOSED': '已收盤',
        'PREPRE': '盤前交易',
        'UNKNOWN': '未知狀態'
    };
    return stateMap[state] || state;
}

// 更新最後更新時間
function updateLastUpdateTime() {
    const timeElement = document.getElementById('lastUpdateTime');
    if (!timeElement) return;
    
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    
    timeElement.textContent = `最後更新：${hours}:${minutes}:${seconds}`;
}

// 渲染自選股列表
function renderWatchlist() {
    const watchlist = document.getElementById('watchlist');
    if (!watchlist) return;

    watchlist.innerHTML = watchlistStocks.map((symbol, index) => {
        const stock = stocks.find(s => s.ticker === symbol);
        if (!stock) return '';

        return `
            <div class="flex items-center justify-between p-3 bg-secondary rounded-lg" 
                 draggable="true" 
                 data-index="${index}"
                 ondragstart="dragStart(event)"
                 ondragover="dragOver(event)"
                 ondrop="drop(event)">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-medium">
                        <span class="text-white font-medium">${stock.ticker[0]}</span>
                    </div>
                    <div>
                        <div class="font-medium">${stock.ticker}</div>
                        <div class="text-sm text-gray-400">${stock.name}</div>
                    </div>
                </div>
                <button class="w-8 h-8 flex items-center justify-center" onclick="removeStock(${index})">
                    <i class="ri-delete-bin-line text-gray-400"></i>
                </button>
            </div>
        `;
    }).join('');
}

function addToWatchlist(symbol) {
    if (!watchlistStocks.includes(symbol)) {
        watchlistStocks.push(symbol);
        renderWatchlist();
    }
}

// 搜尋相關功能
const searchStocks = [
    {
        ticker: 'AAPL',
        name: 'Apple Inc.',
        price: 176.38,
        price_change: -0.85,
        logo_url: ''
    },
    {
        ticker: 'MSFT',
        name: 'Microsoft Corp.',
        price: 406.32,
        price_change: -1.23,
        logo_url: ''
    },
    {
        ticker: 'NVDA',
        name: 'NVIDIA Corp.',
        price: 816.95,
        price_change: -2.45,
        logo_url: ''
    }
];

// 搜尋功能
function initSearchFunctionality() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
        const value = e.target.value.toLowerCase().trim();
        clearTimeout(debounceTimer);

        if (value.length === 0) {
            document.getElementById('searchResults').style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(async () => {
            try {
                const response = await fetch(`/autocomplete/${value}`);
                if (!response.ok) throw new Error('搜尋失敗');

                const results = await response.json();
                renderSearchResults(results);
            } catch (error) {
                console.error('搜尋錯誤:', error);
                showError('搜尋時發生錯誤');
            }
        }, 300);
    });
}

// 渲染搜尋結果
function renderSearchResults(stocks) {
    const searchResults = document.getElementById('searchResults');
    if (!searchResults) return;

    searchResults.innerHTML = stocks.map(stock => `
        <div class="flex items-center justify-between p-3 bg-secondary rounded-lg">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                    <span class="text-white font-medium">${stock.ticker[0]}</span>
                </div>
                <div>
                    <div class="font-medium">${stock.ticker}</div>
                    <div class="text-sm ${stock.price_change >= 0 ? 'text-green-500' : 'text-red-500'}">
                        $${stock.price.toFixed(2)}
                        ${stock.price_change >= 0 ? '+' : ''}${stock.price_change.toFixed(2)}%
                    </div>
                </div>
            </div>
            <button class="w-8 h-8 flex items-center justify-center" onclick="addToWatchlist('${stock.ticker}')">
                <i class="ri-add-line text-gray-400"></i>
            </button>
        </div>
    `).join('');

    searchResults.style.display = stocks.length > 0 ? 'block' : 'none';
}

// 股票數據初始化邏輯
async function initializeStocks() {
    try {
        const userInfo = JSON.parse(sessionStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) {
            console.error('未找到用戶資訊');
            return;
        }

        const response = await fetch(`/watchlist/${userInfo.email}`);
        if (!response.ok) {
            throw new Error('獲取自選股列表失敗');
        }

        const newStocks = await response.json();
        if (!Array.isArray(newStocks)) {
            throw new Error('無效的股票數據格式');
        }

        // 更新全局股票數據
        stocks = newStocks.length > 0 ? newStocks : initStockData();
        
        // 更新股票列表顯示
        renderStocks();
        
        // 每 10 秒更新一次股價
        setInterval(updateStockPrices, 10000);
    } catch (error) {
        console.error('初始化股票數據時發生錯誤:', error);
        // 如果 API 調用失敗，使用測試數據
        stocks = initStockData();
        renderStocks();
        showError('載入股票數據失敗，使用測試數據');
    }
}

// 在頁面載入時初始化股票數據
document.addEventListener('DOMContentLoaded', () => {
    initializeStocks();
    updateStockPrices();
    initSearchFunctionality();
});

// AI 聊天功能
let isChatWindowOpen = false;

function toggleChatWindow() {
    const chatWindow = document.getElementById('chatWindow');
    isChatWindowOpen = !isChatWindowOpen;
    chatWindow.style.display = isChatWindowOpen ? 'block' : 'none';
}

async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const chatMessages = document.getElementById('chatMessages');
    const message = messageInput.value.trim();
    
    if (!message) return;
    
    // 添加用戶訊息
    const userMessageDiv = document.createElement('div');
    userMessageDiv.className = 'mb-4';
    userMessageDiv.innerHTML = `
        <div class="flex justify-end">
            <div class="bg-blue-600 text-white rounded-lg py-2 px-4 max-w-[80%]">
                ${escapeHtml(message)}
            </div>
        </div>
    `;
    chatMessages.appendChild(userMessageDiv);
    
    // 清空輸入框
    messageInput.value = '';
    
    // 添加載入中動畫
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'mb-4';
    loadingDiv.innerHTML = `
        <div class="flex">
            <div class="bg-gray-700 text-white rounded-lg py-2 px-4 max-w-[80%]">
                <div class="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        </div>
    `;
    chatMessages.appendChild(loadingDiv);
    
    // 滾動到底部
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });
        
        const data = await response.json();
        
        // 移除載入中動畫
        chatMessages.removeChild(loadingDiv);
        
        // 添加 AI 回覆
        const aiMessageDiv = document.createElement('div');
        aiMessageDiv.className = 'mb-4';
        aiMessageDiv.innerHTML = `
            <div class="flex">
                <div class="bg-gray-700 text-white rounded-lg py-2 px-4 max-w-[80%]">
                    ${escapeHtml(data.reply)}
                </div>
            </div>
        `;
        chatMessages.appendChild(aiMessageDiv);
        
        // 滾動到底部
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch (error) {
        // 移除載入中動畫
        chatMessages.removeChild(loadingDiv);
        
        // 顯示錯誤訊息
        const errorDiv = document.createElement('div');
        errorDiv.className = 'mb-4';
        errorDiv.innerHTML = `
            <div class="flex">
                <div class="bg-red-600 text-white rounded-lg py-2 px-4 max-w-[80%]">
                    發生錯誤，請稍後再試
                </div>
            </div>
        `;
        chatMessages.appendChild(errorDiv);
    }
}

// 防止 XSS 攻擊的輔助函數
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
