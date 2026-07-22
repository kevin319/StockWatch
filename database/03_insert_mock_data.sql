-- 插入測試用戶
INSERT INTO users (email, name, picture_url) 
VALUES ('demo@example.com', 'Kevin', NULL);

-- 插入自選股資料
INSERT INTO watchlist_stocks (user_email, ticker, display_order) VALUES
('demo@example.com', 'CWEB', 1),
('demo@example.com', 'KTEC', 2),
('demo@example.com', 'PLTR', 3),
('demo@example.com', '2330.TW', 4);

-- 插入測試用戶數據
INSERT INTO users (email, name, picture_url) VALUES 
('test@example.com', '測試用戶', 'https://example.com/avatar.jpg');

-- 插入測試自選股數據
INSERT INTO watchlist_stocks (user_email, ticker, display_order) VALUES 
('test@example.com', 'AAPL', 1),
('test@example.com', 'GOOGL', 2),
('test@example.com', 'MSFT', 3),
('test@example.com', 'TSLA', 4),
('test@example.com', 'NVDA', 5);

-- 股票價格由程式即時寫入，不插入假資料（假價格會在前端初始畫面短暫顯示造成誤導）
