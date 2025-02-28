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
let mockStocks = [
    {
        symbol: 'CWEB',
        name: 'Direxion Dly CSI CH',
        price: 43.63,
        change: -3.07,
        preMarket: 40.90,
        color: 'bg-blue-600',
        logo_url: ''
    },
    {
        symbol: 'KTEC',
        name: 'KraneShares Hang',
        price: 17.40,
        change: -0.97,
        preMarket: 17.57,
        color: 'bg-blue-500',
        logo_url: ''
    },
    {
        symbol: 'PLTR',
        name: 'Palantir Techn',
        price: 84.77,
        change: -5.08,
        preMarket: 83.74,
        color: 'bg-gray-800',
        logo_url: ''
    },
    {
        symbol: '2330.TW',
        name: 'Taiwan Semiconductor Manufacturing Company',
        price: 84.77,
        change: -5.08,
        preMarket: 83.74,
        color: 'bg-gray-800',
        logo_url: ''
    }
];

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
    for (let stock of mockStocks) {
        const priceData = await fetchStockPrice(stock.symbol);
        if (priceData) {
            stock.price = priceData.price;
            stock.extended_price = priceData.extended_price;
            stock.extended_type = priceData.extended_type;
            stock.extended_change_percent = priceData.extended_change_percent;
            stock.change = Number(priceData.price_change_percent.toFixed(2));
            stock.logo_url = priceData.logo_url;
            stock.name = priceData.company_name || stock.name;
        }
    }
    renderStocks();
}

// 渲染股票列表
function renderStocks() {
    const stockList = document.getElementById('stockList');
    stockList.innerHTML = mockStocks.map(stock => `
        <div class="stock-item p-4 rounded-lg bg-secondary" data-symbol="${stock.symbol}">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full ${!stock.logo_url ? stock.color : ''} flex items-center justify-center overflow-hidden" style="min-width: 2.5rem;">
                        ${stock.logo_url 
                            ? `<img src="${stock.logo_url}" alt="${stock.symbol}" class="w-full h-full object-contain bg-white rounded-full p-1" style="aspect-ratio: 1;" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'text-white font-medium\\'>${stock.symbol[0]}</span>'; this.parentElement.classList.add('${stock.color}');">` 
                            : `<span class="text-white font-medium">${stock.symbol[0]}</span>`
                        }
                    </div>
                    <div>
                        <div class="font-medium">${stock.symbol}</div>
                        <div class="text-sm text-gray-400">${stock.name}</div>
                    </div>
                </div>
                <div class="text-right">
                    <div class="font-medium price">${stock.price.toFixed(2)}</div>
                    <div class="text-sm change ${stock.change >= 0 ? 'price-up' : 'price-down'}">
                        ${stock.change > 0 ? '+' : ''}${stock.change}%
                    </div>
                </div>
            </div>
            <div class="mt-2 text-sm premarket text-right">
                ${stock.extended_price ? 
                    `<span class="${stock.extended_change_percent >= 0 ? 'price-up' : 'price-down'} inline-flex items-center gap-2">
                        <span class="min-w-[32px]">${stock.extended_type === 'PRE' ? '盤前' : '盤後'}</span>
                        <span class="inline-block min-w-[50px] text-right">${stock.extended_price.toFixed(2)}</span>
                        <span class="inline-block min-w-[50px] text-right">${stock.extended_change_percent >= 0 ? '+' : ''}${stock.extended_change_percent.toFixed(2)}%</span>
                    </span>`
                    : '<span class="text-gray-400">無延長交易</span>'
                }
            </div>
        </div>
    `).join('');
}

// 渲染自選股列表
function renderWatchlist() {
    const watchlist = document.getElementById('watchlist');
    if (!watchlist) return;

    watchlist.innerHTML = watchlistStocks.map((symbol, index) => {
        const stock = mockStocks.find(s => s.symbol === symbol);
        if (!stock) return '';

        return `
            <div class="flex items-center justify-between p-3 bg-secondary rounded-lg" 
                 draggable="true" 
                 data-index="${index}"
                 ondragstart="dragStart(event)"
                 ondragover="dragOver(event)"
                 ondrop="drop(event)">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full ${stock.color} flex items-center justify-center text-white font-medium">
                        ${stock.symbol[0]}
                    </div>
                    <div>
                        <div class="font-medium">${stock.symbol}</div>
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
        symbol: 'AAPL',
        name: 'Apple Inc.',
        price: 176.38,
        change: -0.85,
        color: 'bg-gray-600'
    },
    {
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        price: 406.32,
        change: -1.23,
        color: 'bg-blue-600'
    },
    {
        symbol: 'NVDA',
        name: 'NVIDIA Corp.',
        price: 816.95,
        change: -2.45,
        color: 'bg-green-600'
    }
];

// 搜尋功能
function initSearchFunctionality() {
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    
    if (!searchInput || !searchResults) {
        console.error('搜尋相關元素未找到');
        return;
    }

    searchInput.addEventListener('input', async (e) => {
        const value = e.target.value.toLowerCase().trim();
        if (value) {
            try {
                // 調用後端 API 獲取搜尋建議
                const response = await fetch(`/autocomplete/${value}`);
                const data = await response.json();
                
                if (data.suggestions && data.suggestions.length > 0) {
                    // 使用 API 結果
                    renderSearchResults(data.suggestions);
                } else {
                    // 如果 API 沒有結果，使用本地搜尋
                    const filteredStocks = searchStocks.filter(stock =>
                        stock.symbol.toLowerCase().includes(value) ||
                        stock.name.toLowerCase().includes(value)
                    );
                    renderSearchResults(filteredStocks);
                }
                
                // 顯示搜尋結果
                searchResults.classList.remove('hidden');
                document.querySelector('main').classList.add('mb-[280px]');
            } catch (error) {
                console.error('搜尋錯誤:', error);
                // 發生錯誤時使用本地搜尋
                const filteredStocks = searchStocks.filter(stock =>
                    stock.symbol.toLowerCase().includes(value) ||
                    stock.name.toLowerCase().includes(value)
                );
                renderSearchResults(filteredStocks);
            }
        } else {
            // 清空搜尋時隱藏結果
            searchResults.classList.add('hidden');
            document.querySelector('main').classList.remove('mb-[280px]');
        }
    });
}

// 渲染搜尋結果
function renderSearchResults(stocks) {
    const searchResults = document.getElementById('searchResults');
    if (!searchResults) return;

    if (stocks.length === 0) {
        searchResults.innerHTML = `
            <div class="p-3 text-center text-gray-400">
                沒有找到相關股票
            </div>
        `;
        return;
    }

    searchResults.innerHTML = stocks.map(stock => `
        <div class="flex items-center justify-between p-3 bg-secondary rounded-lg">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full ${stock.color || 'bg-blue-600'} flex items-center justify-center text-white font-medium">
                    ${stock.symbol[0]}
                </div>
                <div>
                    <div class="font-medium">${stock.symbol}</div>
                    <div class="text-sm text-gray-400">${stock.name}</div>
                </div>
            </div>
            <button class="w-8 h-8 flex items-center justify-center" onclick="addToWatchlist('${stock.symbol}')">
                <i class="ri-add-line text-gray-400"></i>
            </button>
        </div>
    `).join('');
}

// 初始化
async function initStockData() {
    await renderStocks();
    // 每 10 秒更新一次股價
    setInterval(updateStockPrices, 10000);
}

// 在頁面載入時初始化
document.addEventListener('DOMContentLoaded', () => {
    initStockData();
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
