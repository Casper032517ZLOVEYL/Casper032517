"""Authenticated single-team deployment entrypoint; raw uploads are never stored.
Run with Gunicorn behind an HTTPS buffering/rate-limiting reverse proxy.
"""
import base64
import binascii
import hmac
import json
import mimetypes
import os
import subprocess
import threading
from http import HTTPStatus
from urllib.parse import unquote, urlsplit

from .config import ROOT, Settings, load_dotenv
from .http_api import handle_analysis

MAX_BODY = 8 * 1024 * 1024
HEADERS = [('X-Content-Type-Options','nosniff'),('Referrer-Policy','no-referrer'),
           ('X-Frame-Options','DENY'),('Cache-Control','no-store'),
           ('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")]


def create_app(settings=None, username=None, password=None, allowed_hosts=None):
    load_dotenv()
    settings = settings or Settings.from_env()
    username = os.getenv('OPSPILOT_ACCESS_USER','') if username is None else username
    password = os.getenv('OPSPILOT_ACCESS_PASSWORD','') if password is None else password
    if not username or ':' in username or not password or len(password) < 12:
        raise ValueError('Deployment requires OPSPILOT_ACCESS_USER and a password of at least 12 characters')
    hosts = set(allowed_hosts or os.getenv('OPSPILOT_TRUSTED_HOSTS','localhost,127.0.0.1').split(','))
    hosts = {h.strip().lower() for h in hosts if h.strip()}
    if not hosts or '*' in hosts:
        raise ValueError('Configure explicit trusted host names, without wildcard')
    expected = f'{username}:{password}'.encode()
    guard = threading.BoundedSemaphore(4)
    assets = (ROOT/'dist').resolve()
    mimetypes.add_type('text/javascript','.mjs')

    def app(env, start_response):
        def send(data, status=200, content_type='application/json; charset=utf-8', extra=()):
            if not isinstance(data,bytes):
                data=json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
            start_response(f'{status} {HTTPStatus(status).phrase}',HEADERS+[('Content-Type',content_type),('Content-Length',str(len(data)))]+list(extra))
            return [b'' if env.get('REQUEST_METHOD')=='HEAD' else data]
        try:
            host = env.get('HTTP_HOST','')
            parsed = urlsplit('//'+host)
            if parsed.hostname not in hosts or parsed.username or parsed.password:
                return send({'ok':False,'error':'Host not allowed'},421)
            path = env.get('PATH_INFO','/')
            method = env.get('REQUEST_METHOD','GET')
            if path=='/api/health' and method=='GET':
                return send({'ok':True,'version':'1.3.0'})
            authorization = env.get('HTTP_AUTHORIZATION','')
            supplied = b''
            if authorization.startswith('Basic '):
                try: supplied=base64.b64decode(authorization[6:],validate=True)
                except (ValueError,binascii.Error): pass
            if not hmac.compare_digest(supplied,expected):
                return send({'ok':False,'error':'Authentication required'},401,extra=[('WWW-Authenticate','Basic realm="OpsPilot", charset="UTF-8"')])
            if path=='/api/config' and method=='GET':
                return send({'ai':settings.enabled,'version':'1.3.0','max_rows':20000})
            if path=='/api/analyze' and method=='POST':
                origin=env.get('HTTP_ORIGIN')
                if origin and origin not in ('http://'+host,'https://'+host):
                    return send({'ok':False,'error':'Cross-origin request rejected'},403)
                if env.get('CONTENT_TYPE','').split(';')[0].strip()!='application/json':
                    return send({'ok':False,'error':'JSON required'},415)
                try: length=int(env.get('CONTENT_LENGTH','0') or '0')
                except ValueError: return send({'ok':False,'error':'Invalid content length'},400)
                if not 1 <= length <= MAX_BODY:
                    return send({'ok':False,'error':'Request exceeds 8 MB or is empty'},413)
                if not guard.acquire(blocking=False):
                    return send({'ok':False,'error':'Busy, retry later'},429)
                try:
                    body=env['wsgi.input'].read(length)
                    if len(body)!=length: raise ValueError('Truncated body')
                    return send(handle_analysis(json.loads(body),settings))
                except (ValueError,TypeError,subprocess.SubprocessError,OSError):
                    return send({'ok':False,'error':'Invalid data or analysis timeout'},400)
                finally: guard.release()
            if path.startswith('/api/'):
                return send({'ok':False,'error':'Endpoint not found'},404)
            if method not in ('GET','HEAD'):
                return send({'ok':False,'error':'Method not allowed'},405)
            relative=unquote(path).lstrip('/') or 'index.html'
            candidate=(assets/relative).resolve()
            if not candidate.is_relative_to(assets) or any(part.startswith('.') for part in candidate.relative_to(assets).parts) or not candidate.is_file():
                return send({'ok':False,'error':'Not found'},404)
            content=candidate.read_bytes()
            return send(content,content_type=mimetypes.guess_type(str(candidate))[0] or 'application/octet-stream')
        except (ValueError,OSError,UnicodeError):
            return send({'ok':False,'error':'Invalid request'},400)
    return app
