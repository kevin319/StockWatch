-- 建立使用者資料表
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    picture_url TEXT,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 建立使用者表索引
CREATE INDEX idx_users_email ON users(email);

-- 建立股票價格資料表
CREATE TABLE stock_prices (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(20) NOT NULL,
    company_name VARCHAR(255),
    price DECIMAL(10,2),
    prev_close DECIMAL(10,2),
    price_change DECIMAL(10,2),
    price_change_percent DECIMAL(10,2),
    market_state VARCHAR(20),
    extended_price DECIMAL(10,2),
    extended_type VARCHAR(20),  -- POST_MARKET / AFTER_HOURS 為 11 字，VARCHAR(10) 會寫入失敗
    extended_change DECIMAL(10,2),
    extended_change_percent DECIMAL(10,2),
    logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 建立股票價格表索引
CREATE UNIQUE INDEX idx_stock_prices_ticker ON stock_prices(ticker);
CREATE INDEX idx_stock_prices_created_at ON stock_prices(created_at);

-- 建立自選股清單（分組）資料表
CREATE TABLE watchlists (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    name VARCHAR(50) NOT NULL,
    display_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_watchlists_user_email
        FOREIGN KEY (user_email)
        REFERENCES users(email)
        ON DELETE CASCADE
);

CREATE INDEX idx_watchlists_user ON watchlists(user_email, display_order);
-- 同一使用者不分大小寫不可有同名清單
CREATE UNIQUE INDEX idx_watchlists_user_name ON watchlists(user_email, lower(name));

-- 建立自選股資料表
CREATE TABLE watchlist_stocks (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    watchlist_id INTEGER NOT NULL,
    ticker VARCHAR(20) NOT NULL,
    display_order INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_email
        FOREIGN KEY (user_email)
        REFERENCES users(email)
        ON DELETE CASCADE,
    CONSTRAINT fk_watchlist_stocks_watchlist
        FOREIGN KEY (watchlist_id)
        REFERENCES watchlists(id)
        ON DELETE CASCADE
);

-- 建立自選股表索引
CREATE INDEX idx_watchlist_stocks_user_email ON watchlist_stocks(user_email);
CREATE INDEX idx_watchlist_stocks_ticker ON watchlist_stocks(ticker);

-- 同一清單內不可重複；不同清單可放同一支股票（多重歸屬）
CREATE UNIQUE INDEX idx_unique_watchlist_ticker ON watchlist_stocks(watchlist_id, ticker);
