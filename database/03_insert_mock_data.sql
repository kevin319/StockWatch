-- 插入測試用戶
INSERT INTO users (email, name, picture_url) 
VALUES ('kevin319@gmail.com', 'Kevin', NULL);

-- 插入自選股資料
INSERT INTO watchlist_stocks (user_email, ticker, display_order) VALUES
('kevin319@gmail.com', 'CWEB', 1),
('kevin319@gmail.com', 'KTEC', 2),
('kevin319@gmail.com', 'PLTR', 3),
('kevin319@gmail.com', '2330.TW', 4);

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

-- 插入測試股票價格數據
INSERT INTO stock_prices (ticker, company_name, price, prev_close, price_change, price_change_percent, market_state) VALUES 
('AAPL', 'Apple Inc.', 150.25, 149.80, 0.45, 0.30, 'REGULAR'),
('GOOGL', 'Alphabet Inc.', 2800.50, 2795.20, 5.30, 0.19, 'REGULAR'),
('MSFT', 'Microsoft Corporation', 305.75, 303.25, 2.50, 0.82, 'REGULAR'),
('TSLA', 'Tesla, Inc.', 780.90, 785.50, -4.60, -0.59, 'REGULAR'),
('NVDA', 'NVIDIA Corporation', 450.30, 445.80, 4.50, 1.01, 'REGULAR');
