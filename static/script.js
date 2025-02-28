// 初始化圖表
const ctx = document.getElementById("priceChart").getContext("2d");
const chart = new Chart(ctx, {
    type: "line",
    data: {
        labels: [],
        datasets: [{
            label: "價格走勢",
            data: [],
            borderColor: "blue",
            fill: false
        }]
    },
    options: {
        scales: {
            x: { title: { display: true, text: "時間" } },
            y: { title: { display: true, text: "價格" } }
        }
    }
});

let selectedSymbol = ""; // 儲存選擇的股票代碼

async function fetchSuggestions() {
    const query = document.getElementById("symbol").value;
    if (query.length < 1) {
        document.getElementById("suggestions").style.display = "none";
        return;
    }
    const response = await fetch(`/autocomplete/${query}`);
    const data = await response.json();
    const suggestionsDiv = document.getElementById("suggestions");
    suggestionsDiv.innerHTML = "";
    data.suggestions.forEach(item => {
        const div = document.createElement("div");
        div.textContent = `${item.name} (${item.symbol})`;
        div.onclick = () => {
            document.getElementById("symbol").value = item.name;
            selectedSymbol = item.symbol; // 儲存代碼
            suggestionsDiv.style.display = "none";
            fetchStock(); // 自動查詢
        };
        suggestionsDiv.appendChild(div);
    });
    suggestionsDiv.style.display = "block";
}

async function fetchStock() {
    const input = document.getElementById("symbol").value;
    const symbol = selectedSymbol || input; // 使用選擇的代碼或直接輸入
    const response = await fetch(`/stock/${symbol}`);
    const data = await response.json();
    const infoDiv = document.getElementById("stock-info");
    infoDiv.innerHTML = `
        <p>股票：${data.symbol}</p>
        <p>價格：${data.latest_price.toFixed(2)}</p>
        <p>漲跌：${data.change.toFixed(2)}</p>
        <p>時間：${data.timestamp}</p>
    `;

    // 更新圖表數據
    chart.data.labels = data.history.map(item => item.time.slice(11, 16));
    chart.data.datasets[0].data = data.history.map(item => item.price);
    chart.update();
    selectedSymbol = ""; // 重置選擇
}

async function sendChat() {
    const message = document.getElementById("chat-input").value;
    const response = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
    });
    const data = await response.json();
    document.getElementById("chat-response").innerHTML = `<p>${data.reply}</p>`;
}

// 點擊外部隱藏建議
document.addEventListener("click", (e) => {
    if (!e.target.closest(".input-container")) {
        document.getElementById("suggestions").style.display = "none";
    }
});