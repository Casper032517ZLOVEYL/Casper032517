"""Loopback-only development server. python server.py [--port 8510]"""
import argparse
import json
import secrets
import threading
import time
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from finpilot.agent import configured, load_env
from finpilot.service import analyze, diff_snapshot, ingest, overview, sample, snapshot

ROOT = Path(__file__).resolve().parent
SESSIONS = {}
LOCK = threading.Lock()
MAX_BODY = 15 * 1024 * 1024


def empty_state():
    return {"rows": [], "chunks": [], "files": [], "history": []}


class Handler(BaseHTTPRequestHandler):
    server_version = "FinPilot/0.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(12)

    def send(self, code, body, content_type="application/json; charset=utf-8", cookie=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        if cookie:
            self.send_header("Set-Cookie", f"finpilot_session={cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200")
        self.end_headers()
        self.wfile.write(body)

    def valid_host(self):
        return self.headers.get("Host", "") in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def session(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            pass
        token = cookie.get("finpilot_session")
        token = token.value if token else None
        now = time.monotonic()
        with LOCK:
            for key in list(SESSIONS):
                if now - SESSIONS[key]["touched"] > 7200 and not SESSIONS[key]["lock"].locked():
                    del SESSIONS[key]
            if token not in SESSIONS:
                if len(SESSIONS) >= 32:
                    raise ValueError("本地会话数达到上限，请重启服务清理")
                token = secrets.token_urlsafe(32)
                SESSIONS[token] = {"state": empty_state(), "lock": threading.Lock(), "touched": now}
            SESSIONS[token]["touched"] = now
            return token, SESSIONS[token]

    def do_GET(self):
        if not self.valid_host():
            self.send(403, {"error": "无效Host"})
            return
        path = urlsplit(self.path).path
        if path == "/api/status":
            try:
                token, s = self.session()
                self.send(200, {"model_configured": configured(), "scope": overview(s["state"]), "version": "0.1.0"}, cookie=token)
            except ValueError as e:
                self.send(429, {"error": str(e)})
            return
        static = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                  "/styles.css": ("styles.css", "text/css; charset=utf-8")}
        if path not in static:
            self.send(404, {"error": "未找到"})
            return
        name, mime = static[path]
        self.send(200, (ROOT / "web" / name).read_bytes(), mime)

    def do_POST(self):
        if not self.valid_host() or self.headers.get("Origin") != f"http://{self.headers.get('Host')}":
            self.send(403, {"error": "仅接受本机同源请求"})
            return
        if self.headers.get_content_type() != "application/json":
            self.send(415, {"error": "需要application/json"})
            return
        acquired, s = False, None
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                self.send(413, {"error": "请求为空或超过15MB"})
                return
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("请求需为JSON对象")
            token, s = self.session()
            acquired = s["lock"].acquire(blocking=False)
            if not acquired:
                self.send(409, {"error": "该会话仍有任务执行中"})
                return
            path = urlsplit(self.path).path
            if path == "/api/sample":
                s["state"] = sample()
                result = overview(s["state"])
            elif path == "/api/upload":
                new_state = ingest(body.get("files"))
                s["state"] = new_state  # Commit only after every file passed validation.
                result = overview(new_state)
            elif path == "/api/analyze":
                result = analyze(s["state"], body.get("question"), body.get("mode", "offline"), body.get("consent", False))
            elif path == "/api/snapshot":
                result = snapshot(s["state"])
            elif path == "/api/compare":
                result = diff_snapshot(s["state"], body.get("snapshot"))
            elif path == "/api/reset":
                s["state"] = empty_state()
                result = overview(s["state"])
            else:
                self.send(404, {"error": "未找到"})
                return
            self.send(200, result, cookie=token)
        except (ValueError, UnicodeDecodeError, TypeError) as e:
            self.send(400, {"error": str(e)[:300]})
        except (ConnectionError, TimeoutError):
            pass
        except Exception:
            self.send(500, {"error": "任务处理失败，请缩小文件后重试"})
        finally:
            if acquired:
                s["lock"].release()


def main():
    parser = argparse.ArgumentParser(description="FinPilot本地演示服务")
    parser.add_argument("--port", type=int, default=8510)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("端口需为1024至65535")
    load_env(ROOT / ".env")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    print(f"FinPilot: http://127.0.0.1:{args.port}（仅本机访问；Ctrl+C退出）", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
