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
            company_name: 'Direxion Daily CSI China Internet Index Bull 2X Shares',
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
            company_name: 'Korea Electric Terminal Co., Ltd.',
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
            company_name: 'Palantir Technologies Inc.',
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
            company_name: '台灣積體電路製造股份有限公司',
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
    if (!settingsPage) return;
    
    settingsPage.classList.toggle('hidden');
    
    // 如果設置頁面變為可見，重新渲染自選股列表和所有股票列表
    if (!settingsPage.classList.contains('hidden')) {
        renderSettingsStockList();
        renderStocks();
    }
}

// 渲染設置頁面的股票列表
function renderSettingsStockList() {
    const stockListContainer = document.getElementById('settingsStockList');
    if (!stockListContainer) return;

    stockListContainer.innerHTML = '';

    stocks.forEach((stock, index) => {
        const stockItem = document.createElement('div');
        stockItem.className = 'stock-item bg-secondary rounded-lg p-4 mb-2 cursor-move';
        stockItem.draggable = true;
        stockItem.dataset.index = index;

        stockItem.addEventListener('dragstart', handleDragStart);
        stockItem.addEventListener('dragover', handleDragOver);
        stockItem.addEventListener('drop', handleDrop);
        stockItem.addEventListener('dragenter', handleDragEnter);
        stockItem.addEventListener('dragleave', handleDragLeave);

        stockItem.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="flex-shrink-0">
                    <div class="w-12 h-12 rounded-full bg-blue-600/10 flex items-center justify-center overflow-hidden">
                        ${stock.logo_url ? 
                            `<img src="${stock.logo_url}" alt="${stock.ticker}" class="w-8 h-8 object-contain">` :
                            `<span class="text-blue-600 font-medium text-xl">${stock.ticker[0]}</span>`
                        }
                    </div>
                </div>
                <div class="flex-1 space-y-1">
                    <div class="font-medium">${stock.ticker}</div>
                    <div class="text-sm text-gray-400">${stock.company_name}</div>
                </div>
                <div class="flex items-center gap-2">
                    <i class="ri-drag-move-line text-gray-400"></i>
                    <button onclick="removeStock('${stock.ticker}')" 
                            class="w-8 h-8 flex items-center justify-center text-red-500 hover:bg-red-500/10 rounded-lg">
                        <i class="ri-delete-bin-line"></i>
                    </button>
                </div>
            </div>
        `;

        stockListContainer.appendChild(stockItem);
    });
}

// 移除股票
async function removeStock(ticker) {
    try {
        const userInfo = JSON.parse(sessionStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) {
            throw new Error('找不到使用者資訊');
        }

        // 呼叫後端 API 移除股票
        const response = await fetch(`/watchlist/${userInfo.email}/${ticker}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('移除股票失敗');
        }

        // 從本地數據中移除
        const index = stocks.findIndex(s => s.ticker === ticker);
        if (index >= 0) {
            stocks.splice(index, 1);
            // 更新介面
            renderSettingsStockList();
            renderStocks();
        }
    } catch (error) {
        console.error('移除股票時發生錯誤:', error);
    }
}

async function addToWatchlist(ticker) {
    try {
        // 檢查是否已在股票清單中
        if (stocks.some(stock => stock.ticker === ticker)) {
            throw new Error('此股票已在清單中');
        }

        // 獲取使用者資訊
        const userInfo = JSON.parse(sessionStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) {
            throw new Error('找不到使用者資訊');
        }

        // 呼叫後端 API 新增股票
        const response = await fetch(`/watchlist/add?ticker=${ticker}&user_email=${userInfo.email}`, {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error('新增股票失敗');
        }

        // 取得股票資訊
        const stockResponse = await fetch(`/stockprice/${ticker}`);
        if (!stockResponse.ok) {
            throw new Error('取得股票資訊失敗');
        }
        const stockData = await stockResponse.json();

        // 新增到本地數據
        stocks.push(stockData);

        // 更新介面
        renderSettingsStockList();
        renderStocks();

        // 關閉搜尋結果
        const searchResults = document.getElementById('searchResults');
        const searchInput = document.getElementById('searchInput');
        searchResults.classList.add('hidden');
        searchInput.value = '';

    } catch (error) {
        console.error('新增股票時發生錯誤:', error);
        const searchInput = document.getElementById('searchInput');
        searchInput.value = '';
        searchInput.style.color = '#ef4444';
        searchInput.placeholder = error.message;
        searchInput.style.setProperty('::placeholder', '#ef4444', 'important');
        
        // 新增一個 style 元素來處理 placeholder 顏色
        let style = document.createElement('style');
        style.id = 'searchInputError';
        style.textContent = `
            #searchInput::placeholder {
                color: #ef4444 !important;
            }
        `;
        document.head.appendChild(style);
        
        setTimeout(() => {
            searchInput.style.color = 'white';
            searchInput.placeholder = '搜尋股票代號或名稱';
            // 移除錯誤樣式
            const errorStyle = document.getElementById('searchInputError');
            if (errorStyle) {
                errorStyle.remove();
            }
        }, 3000);
    }
}

// 拖拉相關變數
let draggedItem = null;
let draggedItemIndex = null;

// 拖拉事件處理函數
function handleDragStart(e) {
    draggedItem = e.target;
    draggedItemIndex = parseInt(e.target.dataset.index);
    e.target.classList.add('opacity-50');
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDragEnter(e) {
    e.preventDefault();
    const item = e.target.closest('[data-index]');
    if (item && item !== draggedItem) {
        item.classList.add('bg-blue-500/10');
    }
}

function handleDragLeave(e) {
    const item = e.target.closest('[data-index]');
    if (item) {
        item.classList.remove('bg-blue-500/10');
    }
}

function handleDrop(e) {
    e.preventDefault();
    const dropItem = e.target.closest('[data-index]');
    if (!dropItem || !draggedItem) return;

    // 移除拖拉時的視覺效果
    draggedItem.classList.remove('opacity-50');
    dropItem.classList.remove('bg-blue-500/10');

    const dropIndex = parseInt(dropItem.dataset.index);
    
    // 重新排序股票
    const itemToMove = stocks[draggedItemIndex];
    stocks.splice(draggedItemIndex, 1);
    stocks.splice(dropIndex, 0, itemToMove);

    // 更新介面
    renderSettingsStockList();
    renderStocks();

    // 更新後端
    updateStockOrder();
}

// 更新後端股票順序
async function updateStockOrder() {
    try {
        const userInfo = JSON.parse(sessionStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) return;

        const tickers = stocks.map(stock => stock.ticker);
        
        await fetch('/watchlist/reorder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                user_email: userInfo.email,
                tickers: tickers
            })
        });
    } catch (error) {
        console.error('更新股票順序時發生錯誤:', error);
    }
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
                const response = await fetch(`/stockprice/${stock.ticker}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                if (data.error) {
                    console.error(`獲取 ${stock.ticker} 數據失敗:`, data.error);
                    return stock;
                }
                // 合併新數據，但保留原有的資訊作為備用
                return {
                    ...stock,  // 保留原有的所有資訊作為備用
                    ...data,   // 使用新的資訊（包含 company_name 和 logo_url）
                    company_name: data.company_name || stock.company_name, // 優先使用新的公司名稱
                    logo_url: data.logo_url || stock.logo_url, // 優先使用新的 logo
                };
            } catch (error) {
                console.error(`更新 ${stock.ticker} 時發生錯誤:`, error);
                return stock;
            }
        }));
        
        // 更新全局股票數據
        stocks = updatedStocks;
        
        // 重新渲染股票列表
        renderStocks();
        
        // 更新最後更新時間
        updateLastUpdateTime();
        
    } catch (error) {
        console.error('更新股票價格時發生錯誤:', error);
    }
}

// 渲染股票列表
function renderStocks() {
    const stockList = document.getElementById('stockList');
    stockList.innerHTML = '';

    stocks.forEach((stock, index) => {
        const priceChangeClass = stock.price_change >= 0 ? 'price-up' : 'price-down';
        const priceChangeIcon = stock.price_change >= 0 ? 'ri-arrow-up-s-fill' : 'ri-arrow-down-s-fill';

        const stockItem = document.createElement('div');
        stockItem.className = 'stock-item bg-secondary rounded-lg p-4';
        stockItem.innerHTML = `
            <div class="flex items-center gap-4">
                <!-- 公司 Icon -->
                <div class="flex-shrink-0">
                    <img src="${stock.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(stock.ticker)}&background=random&color=fff`}" 
                         alt="${stock.company_name}" 
                         class="w-12 h-12 rounded-full object-cover bg-gray-700 overflow-hidden">
                </div>

                <!-- 股票資訊 -->
                <div class="flex-1 space-y-1.5">
                    <!-- 第一行：股票代號、市場狀態、收盤價、漲跌幅 -->
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="text-sm font-medium">${stock.ticker}</span>
                            <span class="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
                                ${getMarketStateText(stock.market_state)}
                            </span>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <span class="text-sm font-medium">$${stock.price.toFixed(2)}</span>
                            <div class="flex items-center ${priceChangeClass} text-xs">
                                <i class="${priceChangeIcon}"></i>
                                <span>${Math.abs(stock.price_change_percent).toFixed(2)}%</span>
                            </div>
                        </div>
                    </div>

                    <!-- 第二行：公司名稱 -->
                    <div class="text-sm text-gray-400">${stock.company_name}</div>

                    <!-- 第三行：盤前/盤後資訊 -->
                    <div class="flex justify-end text-xs text-gray-400">
                        <div class="flex items-center gap-1.5">
                            <span>${stock.extended_type === 'PRE_MARKET' ? '盤前' : '盤後'}</span>
                            ${stock.extended_price ? 
                                `<span>$${stock.extended_price.toFixed(2)}</span>
                                <div class="flex items-center ${stock.extended_change >= 0 ? 'price-up' : 'price-down'}">
                                    <i class="${stock.extended_change >= 0 ? 'ri-arrow-up-s-fill' : 'ri-arrow-down-s-fill'}"></i>
                                    <span>${Math.abs(stock.extended_change_percent).toFixed(2)}%</span>
                                </div>` : 
                                '<span>暫無資料</span>'
                            }
                        </div>
                    </div>
                </div>
            </div>
        `;
        stockList.appendChild(stockItem);
    });

    // 更新最後更新時間
    updateLastUpdateTime();
}

// 獲取市場狀態文字
function getMarketStateText(state) {
    switch (state) {
        case 'PRE_MARKET':
            return '盤前交易';
        case 'REGULAR':
            return '交易中';
        case 'POST_MARKET':
            return '盤後交易';
        case 'CLOSED':
            return '已收盤';
        default:
            return '未知狀態';
    }
}

// 更新最後更新時間
function updateLastUpdateTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    document.getElementById('lastUpdateTime').textContent = 
        `最後更新：${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

// 股票數據初始化邏輯
async function initializeStocks() {
    try {
        // 獲取使用者資訊
        const userInfo = JSON.parse(sessionStorage.getItem('user_info'));
        if (!userInfo || !userInfo.email) {
            throw new Error('找不到使用者資訊');
        }

        // 從後端獲取股票數據
        const response = await fetch(`/watchlist/${userInfo.email}`);
        if (!response.ok) {
            throw new Error('獲取股票數據失敗');
        }

        const stocksData = await response.json();
        if (Array.isArray(stocksData)) {
            stocks = stocksData;
        } else {
            stocks = initStockData();
        }

        // 渲染介面
        renderStocks();
        renderSettingsStockList();

        // 開始定期更新
        updateStockPrices();
        setInterval(updateStockPrices, 10000);

        // 更新時間
        updateLastUpdateTime();
        setInterval(updateLastUpdateTime, 1000);

    } catch (error) {
        console.error('初始化股票數據時發生錯誤:', error);
        stocks = initStockData();
        renderStocks();
        renderSettingsStockList();
    }
}

// 在頁面載入時初始化股票數據
document.addEventListener('DOMContentLoaded', () => {
    initializeStocks();
    
    // 初始化搜尋功能
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    
    let searchTimeout;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        if (!query) {
            searchResults.classList.add('hidden');
            return;
        }

        // 清除之前的 timeout
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }

        // 設置新的 timeout，延遲 300ms 後執行搜尋
        searchTimeout = setTimeout(async () => {
            try {
                // 呼叫自動完成 API
                const response = await fetch(`/autocomplete/${encodeURIComponent(query)}`);
                if (!response.ok) {
                    throw new Error('搜尋失敗');
                }
                const results = await response.json();

                // 顯示搜尋結果
                searchResults.innerHTML = '';
                searchResults.classList.remove('hidden');
                
                if (results.length === 0) {
                    searchResults.innerHTML = `
                        <div class="p-3 text-center text-gray-400 text-sm">
                            找不到符合的股票
                        </div>
                    `;
                    return;
                }

                results.forEach(stock => {
                    const resultItem = document.createElement('div');
                    resultItem.className = 'flex items-center justify-between p-3 bg-secondary rounded-lg cursor-pointer hover:bg-blue-600/10';
                    resultItem.onclick = () => addToWatchlist(stock.symbol);
                    
                    resultItem.innerHTML = `
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-blue-600/10 flex items-center justify-center">
                                <span class="text-blue-600 font-medium">${stock.symbol[0]}</span>
                            </div>
                            <div>
                                <div class="font-medium">${stock.symbol}</div>
                                <div class="text-sm text-gray-400">${stock.name}</div>
                                <div class="text-xs text-gray-500">${stock.exchange}</div>
                            </div>
                        </div>
                        <button class="w-8 h-8 flex items-center justify-center text-blue-600">
                            <i class="ri-add-line"></i>
                        </button>
                    `;
                    
                    searchResults.appendChild(resultItem);
                });
            } catch (error) {
                console.error('搜尋時發生錯誤:', error);
                searchResults.innerHTML = `
                    <div class="p-3 text-center text-gray-400 text-sm">
                        搜尋時發生錯誤
                    </div>
                `;
            }
        }, 300);
    });

    // 點擊其他地方時隱藏搜尋結果
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#searchInput') && !e.target.closest('#searchResults')) {
            searchResults.classList.add('hidden');
        }
    });
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
    userMessageDiv.className = 'mb-2';
    userMessageDiv.innerHTML = `
        <div class="flex justify-end">
            <div class="bg-[#0B93F6] text-white rounded-[20px] py-[8px] px-[12px] max-w-[70%] relative mr-2">
                ${escapeHtml(message)}
            </div>
        </div>
    `;
    chatMessages.appendChild(userMessageDiv);
    
    // 清空輸入框
    messageInput.value = '';
    
    // 添加載入中動畫
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'mb-2';
    loadingDiv.innerHTML = `
        <div class="flex">
            <div class="bg-[#303030] text-white rounded-[20px] py-[8px] px-[12px] max-w-[70%] relative ml-2">
                <div class="flex space-x-1">
                    <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
                    <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.4s"></div>
                </div>
            </div>
        </div>
    `;
    chatMessages.appendChild(loadingDiv);
    
    // 滾動到底部
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });
        
        const data = await response.json();
        
        // 添加 AI 回覆
        const aiMessageDiv = document.createElement('div');
        aiMessageDiv.className = 'mb-2';
        const messageHtml = marked.parse(data.response.trim());
        aiMessageDiv.innerHTML = `
            <div class="flex">
                <div class="bg-[#303030] text-white rounded-[20px] py-[6px] px-[10px] max-w-[70%] relative ml-2 markdown-content whitespace-pre-line">
                    ${messageHtml}
                </div>
            </div>
        `;
        chatMessages.appendChild(aiMessageDiv);
        
    } catch (error) {
        // 顯示錯誤訊息
        const errorDiv = document.createElement('div');
        errorDiv.className = 'mb-2';
        errorDiv.innerHTML = `
            <div class="flex">
                <div class="bg-[#303030] text-white rounded-[20px] py-[8px] px-[12px] max-w-[70%] relative ml-2">
                    發生錯誤，請稍後再試
                </div>
            </div>
        `;
        chatMessages.appendChild(errorDiv);
    } finally {
        // 移除載入中動畫
        if (loadingDiv && loadingDiv.parentNode === chatMessages) {
            chatMessages.removeChild(loadingDiv);
        }
        
        // 滾動到底部
        chatMessages.scrollTop = chatMessages.scrollHeight;
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

// 添加樣式到 head
const style = document.createElement('style');
style.textContent = `
    .markdown-content {
        line-height: 1.3;
        font-size: 0.95rem;
    }
    .markdown-content p {
        margin: 0;
    }
    .markdown-content p:not(:last-child) {
        margin-bottom: 0.3em;
    }
    .markdown-content strong {
        color: #fff;
        font-weight: 700;
    }
    .markdown-content em {
        font-style: italic;
        color: #e2e8f0;
    }
    .markdown-content ul, .markdown-content ol {
        margin: 0;
        padding-left: 1.2em;
    }
    .markdown-content li {
        margin: 0;
    }
    .markdown-content code {
        background: rgba(255,255,255,0.1);
        padding: 0.2em 0.4em;
        border-radius: 3px;
        font-size: 0.9em;
    }
    .markdown-content br {
        display: none;
    }
`;
document.head.appendChild(style);
