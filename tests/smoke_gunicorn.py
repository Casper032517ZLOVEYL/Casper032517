"""Smoke the pinned production server over real HTTP. No secrets or business rows logged."""
import base64
import csv
import json
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def main():
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    password=secrets.token_urlsafe(24)
    env={**os.environ,'OPSPILOT_ACCESS_USER':'smoke','OPSPILOT_ACCESS_PASSWORD':password,'OPSPILOT_TRUSTED_HOSTS':'127.0.0.1','OPSPILOT_API_KEY':''}
    p=subprocess.Popen([sys.executable,'-m','gunicorn','--bind',f'127.0.0.1:{port}','--workers','1','--threads','4','--timeout','90','opspilot.wsgi:create_app()'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    def req(path,body=None,auth=True):
        headers={'Content-Type':'application/json'}
        if auth:headers['Authorization']='Basic '+base64.b64encode(f'smoke:{password}'.encode()).decode()
        request=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
        try:
            with urllib.request.urlopen(request,timeout=5) as r:return r.status,r.read()
        except urllib.error.HTTPError as e:return e.code,e.read()
    try:
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if p.poll() is not None:raise RuntimeError('Gunicorn exited before readiness')
            try:
                if req('/api/health',auth=False)[0]==200:break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('Gunicorn not ready')
        assert req('/',auth=False)[0]==401
        assert req('/')[0]==200
        with (ROOT/'dist/datasets/uci-daily-nov2011.csv').open() as f:raw=list(csv.DictReader(f))
        by_date={r['date']:r for r in raw}
        rows=[{'date':f'2011-11-{i:02}','channel':'United Kingdom','orders':int(by_date.get(f'2011-11-{i:02}',{}).get('orders',0)),'revenue':float(by_date.get(f'2011-11-{i:02}',{}).get('revenue',0))} for i in range(1,31)]
        status,body=req('/api/analyze',{'rows':rows,'question':'销售金额','dataset':{'version':1,'currency':'GBP','revenueBasis':'gross'}})
        result=json.loads(body)
        assert status==200 and result['ok'] and abs(result['current']-277736.03)<.000001
        assert result['currency']=='GBP' and not result['ai']
        print('Gunicorn 26.2.0 actual HTTP: readiness, login protection, static UI and real-data analysis PASS')
    finally:
        p.terminate()
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)

if __name__=='__main__':main()
