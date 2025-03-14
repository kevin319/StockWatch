from fastapi.testclient import TestClient
from main import app
import unittest

class TestMain(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_app_initialization(self):
        # 測試 FastAPI 應用實例是否正確初始化
        self.assertIsNotNone(app)
        self.assertEqual(app.title, "FastAPI")

    def test_cors_middleware(self):
        # 測試 CORS 中介軟體設定
        response = self.client.options("/")
        self.assertEqual(response.headers["access-control-allow-origin"], "*")
        self.assertEqual(response.headers["access-control-allow-methods"], "*")

    def test_static_files_mount(self):
        # 測試靜態文件掛載
        response = self.client.get("/static/styles.css")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/css", response.headers["content-type"])

    def test_routers_registration(self):
        # 測試路由註冊狀態
        routes = app.routes
        route_paths = [route.path for route in routes]
        self.assertIn("/api", route_paths)
        self.assertIn("/static", route_paths)

    def test_main_execution_block(self):
        """測試主程式執行時的日誌輸出與端口設定"""
        with self.assertLogs(level="INFO") as cm:
            __import__("main").__name__
            logs = ','.join(cm.output)
            self.assertIn("Uvicorn running", logs)
            self.assertIn(":8000", logs)

    def test_auth_endpoints(self):
        """測試授權相關端點狀態碼與回應格式"""
        response = self.client.get('/api/')
        self.assertEqual(response.status_code, 200)

        response = self.client.get('/api/verify_token?token=invalid')
        self.assertEqual(response.status_code, 401)

    def test_chat_endpoint(self):
        """測試聊天API的請求處理與錯誤回應"""
        test_data = {"message": "test"}
        response = self.client.post("/api/chat", json=test_data)
        self.assertIn(response.status_code, [200, 400])

    def test_stock_endpoints(self):
        """測試股票資料端點的JSON結構與狀態碼"""
        response = self.client.get("/api/stock/2330")
        self.assertEqual(response.status_code, 200)
        self.assertIn("symbol", response.json())

if __name__ == "__main__":
    unittest.main()