-- 插入測試用戶
INSERT INTO users (email, name, picture_url) 
VALUES ('kevin319@gmail.com', 'Kevin', NULL);

-- 插入自選股資料
INSERT INTO watchlist_stocks (user_email, ticker, display_order) VALUES
('kevin319@gmail.com', 'CWEB', 1),
('kevin319@gmail.com', 'KTEC', 2),
('kevin319@gmail.com', 'PLTR', 3),
('kevin319@gmail.com', '2330.TW', 4);
