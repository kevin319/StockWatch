-- 建立自動更新 updated_at 的觸發器函數
CREATE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 創建更新時間戳的函數
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 為所有資料表添加更新時間觸發器
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stock_prices_updated_at
    BEFORE UPDATE ON stock_prices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_watchlist_stocks_updated_at
    BEFORE UPDATE ON watchlist_stocks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 為 users 表添加更新時間戳觸發器
CREATE TRIGGER update_users_timestamp
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- 為 stock_prices 表添加更新時間戳觸發器
CREATE TRIGGER update_stock_prices_timestamp
    BEFORE UPDATE ON stock_prices
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- 為 watchlist_stocks 表添加更新時間戳觸發器
CREATE TRIGGER update_watchlist_stocks_timestamp
    BEFORE UPDATE ON watchlist_stocks
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
