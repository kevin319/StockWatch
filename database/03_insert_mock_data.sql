-- 插入測試用戶
INSERT INTO users (email, name, picture_url) 
VALUES ('demo@example.com', 'Kevin', NULL);

-- 插入自選股資料
INSERT INTO watchlist_stocks (user_email, ticker, display_order) VALUES
('demo@example.com', 'CWEB', 1),
('demo@example.com', 'KTEC', 2),
('demo@example.com', 'PLTR', 3),
('demo@example.com', '2330.TW', 4);
