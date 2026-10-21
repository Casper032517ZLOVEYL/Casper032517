"""OpsPilot local HTTP server. Run python server.py; no third-party dependencies."""
import json
import os
import socket
import subprocess
import threading
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from opspilot.config import ROOT, Settings, load_dotenv
from opspilot.service import analyze_request

load_dotenv()
_GUARD = threading.BoundedSemaphore(4)


class Handler(SimpleHTTPRequestHandler):
    settings = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "dist"), **kwargs)

    def log_message(self, *_args):
        # Do not log uploaded rows, user questions, credentials or model responses.
        pass

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def reply(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def current_settings(self):
        return self.settings or Settings.from_env()

    def do_GET(self):
        if self.path == "/api/config":
            return self.reply({"ai": self.current_settings().enabled, "version": "1.1.0", "max_rows": 20000})
        if self.path == "/api/health":
            return self.reply({"ok": True, "version": "1.1.0"})
        if urlparse(self.path).path.startswith("/api/"):
            return self.reply({"ok": False, "error": "接口不存在。"}, 404)
        return super().do_GET()

    def list_directory(self, path):
        return self.reply({"ok": False, "error": "目录浏览已关闭。"}, 404)

    def do_POST(self):
        if self.path != "/api/analyze":
            return self.reply({"ok": False, "error": "接口不存在。"}, 404)
        origin, host = self.headers.get("Origin"), self.headers.get("Host", "")
        if origin and origin not in ("http://" + host, "https://" + host):
            return self.reply({"ok": False, "error": "拒绝跨来源请求。"}, 403)
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self.reply({"ok": False, "error": "请求须为 JSON。"}, 415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.reply({"ok": False, "error": "无效请求长度。"}, 400)
        if not 1 <= length <= 8 * 1024 * 1024:
            return self.reply({"ok": False, "error": "请求为空或超过8 MB。"}, 413)
        if not _GUARD.acquire(blocking=False):
            return self.reply({"ok": False, "error": "正在处理其他分析，请稍后重试。"}, 429)
        try:
            self.connection.settimeout(30)
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or not isinstance(payload.get("question"), str) or not isinstance(payload.get("rows"), list):
                raise ValueError("Invalid request")
            if len(payload["question"]) > 500 or len(payload["rows"]) > 20000:
                raise ValueError("Input limit exceeded")
            channel = payload.get("channel")
            if channel is not None and (not isinstance(channel, str) or len(channel) > 80):
                raise ValueError("Invalid channel")
            result = analyze_request({"rows": payload["rows"], "question": payload["question"], "channel": channel}, self.current_settings())
            result["request_id"] = str(uuid.uuid4())
            return self.reply(result)
        except (ValueError, TypeError, subprocess.SubprocessError, OSError, socket.timeout):
            return self.reply({"ok": False, "error": "输入无效或处理超时，请核对数据。"}, 400)
        finally:
            _GUARD.release()


if __name__ == "__main__":
    try:
        Handler.settings = Settings.from_env()
    except ValueError as error:
        raise SystemExit("配置无效：" + str(error))
    host = os.getenv("OPSPILOT_HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8501"))
    print(f"OpsPilot http://{host}:{port} | AI configured: {Handler.settings.enabled}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
