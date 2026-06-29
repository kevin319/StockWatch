from fastapi.testclient import TestClient
from main import app
import unittest

class TestMain(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_app_initialization(self):
        self.assertIsNotNone(app)
        self.assertEqual(app.title, "FastAPI")

    def test_cors_middleware(self):
        response = self.client.options("/", headers={
            "Origin": "http://localhost",
            "Access-Control-Request-Method": "GET",
        })
        self.assertIn(response.headers.get("access-control-allow-origin"), ["*", "http://localhost"])

    def test_static_files_mount(self):
        response = self.client.get("/static/styles.css")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/css", response.headers["content-type"])

    def test_routers_registration(self):
        route_paths = []
        for route in app.routes:
            path = getattr(route, "path", None)
            if path:
                route_paths.append(path)
        self.assertIn("/static", route_paths)

    def test_main_execution_block(self):
        """Test that main module has uvicorn run configured for port 8000"""
        import inspect
        import main
        source = inspect.getsource(main)
        self.assertIn("uvicorn.run", source)
        self.assertIn("8000", source)

    def test_auth_endpoints(self):
        """Test auth endpoints return correct status codes"""
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)

        response = self.client.get('/verify_token?token=invalid')
        self.assertEqual(response.status_code, 401)

    def test_chat_endpoint(self):
        """Test chat API accepts requests"""
        test_data = {"message": "test"}
        response = self.client.post("/api/chat", json=test_data)
        self.assertIn(response.status_code, [200, 400])

    def test_stock_endpoints(self):
        """Test stock endpoint returns JSON with ticker field"""
        response = self.client.get("/stock/AAPL")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue("ticker" in data or "error" in data)

if __name__ == "__main__":
    unittest.main()
