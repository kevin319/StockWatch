# StockWatch 搬遷 Oracle Cloud 計畫

> **已於 2026-09-07 完成。** VM: `158.101.150.86`（ap-tokyo-1，A1.Flex 1 OCPU / 6 GB）。
> 實際執行紀錄、部署腳本與維運方式見 `git/cloud-deploy/README.md`。
> 實作與原計畫的主要差異：改用 GitHub Actions 自動 build arm64 image 推到
> ghcr.io，VM 只負責 pull —— 原計畫的「VM 上 clone repo 再 build」已廢棄
> （1 OCPU build 太慢，且需把 git 憑證放上雲端）。

## 目標

把 Mac Docker Desktop 上的 3 個對外服務 + 1 個 DB 搬到 Oracle Cloud Always Free ARM VM，解決：
- Docker 時鐘飄移（市場狀態誤判、OAuth 登入失敗）
- Mac 睡眠時服務中斷
- iPhone PWA 因 Mac 離線而無法使用

## 搬遷範圍

### 搬上 Oracle Cloud（5 個容器）

| 服務 | Image | DB | 資料需遷移 |
|------|-------|-----|-----------|
| Caddy | caddy:2-alpine | — | — |
| StockWatch | 自建 (FastAPI) | PostgreSQL（共用） | backups/ |
| PostgreSQL | postgres:15-alpine | — | mystock_data volume |
| investforlife-web | 自建 (靜態網站) | 無 | 無 |
| mr-market | 自建 | SQLite（自帶） | data/market.db + JSON |

### DB 策略

- **PostgreSQL 獨立為共用基礎服務**，目前只有 StockWatch 使用，未來其他服務有需要可以直接連
- **mr-market 維持 SQLite**，不遷移到 PostgreSQL。原因：
  - 單一寫入者，SQLite 效能更好且零維運成本
  - 服務解耦：PostgreSQL 掛掉不影響 mr-market
  - 保持獨立部署能力，日後可單獨搬走
- **investforlife-web 無 DB**，純靜態網站

### 留在 Mac（不搬）

| 服務 | 原因 |
|------|------|
| artifacts-viewer | 依賴本機 Obsidian vault（唯讀掛載） |
| jobhub | launchd 原生服務，管理本機排程與 job 執行 |
| Caddy (Mac) | 繼續服務上面兩個 |

兩者都已在 2026-09-05 完成 HTTPS 化（`artifacts.` / `jobhub.investforlife.fun`），
DNS 維持指向家用 IP，切換雲端時不要動這兩筆記錄。

## Oracle Cloud VM 規格

- **Shape**: VM.Standard.A1.Flex（ARM / Ampere A1）
- **OCPU**: 1
- **RAM**: 6 GB
- **Boot Volume**: 預設 46.6 GB（夠用，且不動 custom 設定就不會誤選到收費的 VPU 等級）

> 免費額度上限是 4 OCPU / 24 GB，但 2/12 常態性 `Out of capacity`。
> 改用 1/6 排到的機率高很多，實測五個容器只吃約 1 GB RAM。
> 日後可關機 resize 升級。
- **OS**: Ubuntu 22.04 (aarch64)
- **Home Region**: Japan East (Tokyo)，對台灣延遲 ~30-40ms

## 架構

```
Internet (HTTPS :443)
    │
    ▼
  Caddy（VM 上，唯一對外）
    │
    ├─ stock.domain.com    → stockwatch:8000 ──→ PostgreSQL :5432
    ├─ invest.domain.com   → investforlife:80
    └─ mrmarket.domain.com → mr-market:8080  ──→ SQLite (data/market.db)
```

- 對外只開 port 443（+ 80 給 HTTP→HTTPS 重導向）
- 各服務只 expose 內部 port，PostgreSQL 不對外
- Caddy 自動申請 + 續期 Let's Encrypt 憑證
- 所有服務在同一個 Docker network
- 各服務使用最適合的 DB，不強求統一

## 檔案結構（VM 上）

實際結果（**沒有任何原始碼**——image 由 GitHub Actions build 後推到 ghcr.io）：

```
~/cloud/
├── docker-compose.yml    # 統一編排所有服務 + Caddy，用 image: 不用 build:
├── Caddyfile             # 反向代理設定
├── .env                  # 所有密鑰（600）
├── backups/              # StockWatch DB 排程備份
└── mr-market-data/       # mr-market 的 SQLite + JSON
```

## 執行步驟

### Phase A — Oracle Cloud 帳號 + VM

1. 註冊 cloud.oracle.com（需信用卡驗證，不扣款）
2. Home Region 選 Japan East (Tokyo)
3. Mac 產生 SSH key：`ssh-keygen -t ed25519 -f ~/.ssh/oracle_cloud`
4. 建立 ARM VM（1 OCPU / 6GB / 預設 boot volume / Ubuntu 22.04 aarch64）
5. OCI Security List 開 Ingress 80, 443
6. SSH 進去開 OS 層 iptables 80, 443

### Phase B — 裝 Docker

7. `curl -fsSL https://get.docker.com | sudo sh`
8. `sudo usermod -aG docker $USER`，重新登入
9. 驗證 `docker compose version`

### Phase C — 部署服務

10. Git clone 三個 repo 到 ~/cloud/
11. 建立 .env（JWT_SECRET 重新產生，其他從 Mac 複製）
12. 寫統一的 docker-compose.yml
13. 寫 Caddyfile
14. `docker compose up -d --build`

### Phase D — DNS + HTTPS

15. DNS A record 全部改指向 Oracle VM IP
16. 安裝 Caddy（OS 層或容器）
17. 驗證 HTTPS 憑證自動簽發

### Phase E — 資料遷移

18. Mac 上 `pg_dump` 匯出 StockWatch DB
19. scp 上傳到 VM
20. VM 上 `psql` 匯入
21. scp 上傳 mr-market 的 data/ 目錄

### Phase F — 驗證 + 切換

22. 更新 Google OAuth 設定，加入新域名（保留舊的）
23. 測試所有服務登入、功能正常
24. iPhone 重新加入主畫面
25. 確認穩定後，Mac 上停掉已搬走的容器

## .env 變數清單

| 變數 | 來源 |
|------|------|
| POSTGRES_USER | stockwatch |
| POSTGRES_PASSWORD | 重新產生 |
| POSTGRES_DB | stockwatch |
| POSTGRES_PORT | 5432 |
| GOOGLE_CLIENT_ID | 從 Mac 複製 |
| GOOGLE_CLIENT_SECRET | 從 Mac 複製 |
| JWT_SECRET | 重新產生：`openssl rand -hex 32` |
| JWT_ALGORITHM | HS256 |
| FINNHUB_API_KEY | 從 Mac 複製 |
| DEEPSEEK_API_KEY | 從 Mac 複製 |
| DEEPSEEK_API_URL | https://api.deepseek.com |
| DEEPSEEK_MODEL | deepseek-v4-flash |
| SSO_SECRET | 從 Mac 複製 |
| LLM_API_KEY | 從 Mac 的 mr-market .env 複製 |
| LLM_BASE_URL | 從 Mac 的 mr-market .env 複製 |
| LLM_MODEL | 從 Mac 的 mr-market .env 複製 |

## 注意事項

- **ARM 架構**：三個自建 image 都是 Python，ARM 上直接 build 沒問題。postgres:15-alpine 也有 ARM 版。
- **JWT_SECRET 換新**：雲端用新 secret，舊 token 失效，使用者重新登入即可。
- **Mac 的 Caddy 要調整**：搬走的服務從 Mac Caddyfile 移除，只留 artifacts-viewer。
- **備份策略**：StockWatch 已有排程備份寫到 backups/，在 VM 上同樣掛出來即可。
- **DNS 切換有傳播延遲**：改 A record 後可能需要幾分鐘到幾小時生效，期間新舊 IP 都可能收到流量。
