"""Deployment contract via actual loopback HTTP, independent Decimal gold and no paid model calls."""
import base64
import csv
import json
import threading
import unittest
import urllib.error
import urllib.request
from decimal import Decimal
from io import BytesIO
from wsgiref.simple_server import WSGIRequestHandler, make_server
from opspilot.wsgi import create_app, MAX_BODY
from opspilot.config import ROOT, Settings
from opspilot.http_api import handle_analysis
from unittest.mock import patch

class QuietHandler(WSGIRequestHandler):
    def log_message(self,*_): pass

class DeploymentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.user='test-user';cls.password='test-only-long-password'
        cls.app=create_app(settings=Settings(),username=cls.user,password=cls.password)
        cls.server=make_server('127.0.0.1',0,cls.app,handler_class=QuietHandler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base=f'http://127.0.0.1:{cls.server.server_port}'
        with (ROOT/'dist/datasets/uci-daily-nov2011.csv').open() as f:
            source=list(csv.DictReader(f))
        by_date={r['date']:r for r in source}
        cls.rows=[{'date':f'2011-11-{i:02}', 'channel':'United Kingdom',
                   'orders':int(by_date.get(f'2011-11-{i:02}',{}).get('orders',0)),
                   'revenue':float(by_date.get(f'2011-11-{i:02}',{}).get('revenue',0))} for i in range(1,31)]
        cls.payload={'rows':cls.rows,'question':'销售金额','dataset':{'version':1,'currency':'GBP','revenueBasis':'gross','mode':'daily','zeroFilled':4}}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()

    def request(self,path='/',body=None,auth=True,headers=None):
        h={'Content-Type':'application/json'}
        if auth:h['Authorization']='Basic '+base64.b64encode(f'{self.user}:{self.password}'.encode()).decode()
        h.update(headers or {})
        req=urllib.request.Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers=h)
        try:
            with urllib.request.urlopen(req,timeout=10) as r:return r.status,r.read(),r.headers
        except urllib.error.HTTPError as e:return e.code,e.read(),e.headers

    def test_frontend_requires_authentication(self):
        status,_,headers=self.request(auth=False);self.assertEqual(status,401);self.assertIn('Basic',headers['WWW-Authenticate'])
    def test_api_requires_authentication(self):self.assertEqual(self.request('/api/analyze',self.payload,auth=False)[0],401)
    def test_wrong_password_is_rejected(self):self.assertEqual(self.request(headers={'Authorization':'Basic d3Jvbmc6d3Jvbmc='})[0],401)
    def test_valid_auth_gets_frontend_and_security_headers(self):
        status,body,h=self.request();self.assertEqual(status,200);self.assertIn(b'OpsPilot',body);self.assertEqual(h['X-Frame-Options'],'DENY');self.assertIn("script-src 'self'",h['Content-Security-Policy'])
    def test_health_has_no_business_data_and_does_not_need_auth(self):
        status,body,_=self.request('/api/health',auth=False);self.assertEqual(status,200);self.assertEqual(json.loads(body),{'ok':True,'version':'1.3.0'})
    def test_config_has_no_credentials(self):
        status,body,_=self.request('/api/config');self.assertEqual(status,200);self.assertNotIn(self.password,body.decode());self.assertNotIn('api_key',body.decode())
    def test_unknown_host_is_rejected(self):self.assertEqual(self.request(headers={'Host':'attacker.invalid'})[0],421)
    def test_cross_origin_is_rejected(self):self.assertEqual(self.request('/api/analyze',self.payload,headers={'Origin':'https://attacker.invalid'})[0],403)
    def test_asset_traversal_is_rejected(self):self.assertEqual(self.request('/%2e%2e/server.py')[0],404)
    def test_hidden_files_are_rejected(self):self.assertEqual(self.request('/.env')[0],404)
    def test_directory_browsing_is_rejected(self):self.assertEqual(self.request('/lib/')[0],404)
    def test_unsupported_media_type_is_rejected(self):self.assertEqual(self.request('/api/analyze',self.payload,headers={'Content-Type':'text/plain'})[0],415)
    def test_unknown_endpoint_is_rejected(self):self.assertEqual(self.request('/api/unknown')[0],404)
    def test_json_payload_shape_is_validated(self):self.assertEqual(self.request('/api/analyze',[])[0],400)
    def test_true_real_data_analysis_and_partial_fields_over_http(self):
        status,body,_=self.request('/api/analyze',self.payload);r=json.loads(body)
        self.assertEqual(status,200);self.assertTrue(r['ok']);self.assertAlmostEqual(r['current'],277736.03);self.assertEqual(r['currency'],'GBP');self.assertFalse(r['ai'])
    def test_custom_range_reaches_shared_engine(self):
        status,body,_=self.request('/api/analyze',{**self.payload,'range':{'start':'2011-11-17','end':'2011-11-23'}});r=json.loads(body)
        self.assertTrue(r['ok']);self.assertAlmostEqual(r['current'],284447.21)
    def test_missing_metric_returns_actionable_refusal(self):
        r=json.loads(self.request('/api/analyze',{**self.payload,'question':'ROAS'})[1]);self.assertFalse(r['ok']);self.assertIn('cost',r['error'])
    def test_model_defaults_to_no_external_disclosure(self):
        with patch('opspilot.http_api.analyze_request',return_value={'ok':True}) as call:
            handle_analysis(self.payload,Settings(api_key='test-only',model='mock'))
            self.assertFalse(call.call_args.args[1].enabled)
    def test_model_requires_explicit_consent(self):
        with patch('opspilot.http_api.analyze_request',return_value={'ok':True}) as call:
            handle_analysis({**self.payload,'use_model':True},Settings(api_key='test-only',model='mock'))
            self.assertTrue(call.call_args.args[1].enabled)
    def test_string_model_consent_cannot_enable_model(self):self.assertEqual(self.request('/api/analyze',{**self.payload,'use_model':'yes'})[0],400)
    def test_deploy_app_will_not_start_with_weak_or_missing_credentials(self):
        for password in ('','123'):
            with self.assertRaises(ValueError):create_app(settings=Settings(),username='user',password=password)
    def test_oversized_body_rejected_before_reading(self):
        env={'HTTP_HOST':'localhost','PATH_INFO':'/api/analyze','REQUEST_METHOD':'POST','CONTENT_TYPE':'application/json','CONTENT_LENGTH':str(MAX_BODY+1),'HTTP_AUTHORIZATION':'Basic '+base64.b64encode(f'{self.user}:{self.password}'.encode()).decode(),'wsgi.input':BytesIO(b'')}
        result=[];self.__class__.app(env,lambda status,headers:result.append(status));self.assertTrue(result[0].startswith('413'))
    def test_real_daily_and_order_totals_reconcile_with_decimal_independent_of_js(self):
        with (ROOT/'dist/datasets/uci-daily-nov2011.csv').open() as f:daily=list(csv.DictReader(f))
        with (ROOT/'dist/datasets/uci-orders-nov2011.csv').open() as f:orders=list(csv.DictReader(f))
        self.assertEqual(sum((Decimal(r['revenue']) for r in daily),Decimal(0)),Decimal('1325346.21'))
        self.assertEqual(sum((Decimal(r['revenue']) for r in orders),Decimal(0)),Decimal('1325346.21'))
        self.assertEqual(sum(int(r['orders']) for r in daily),len(orders));self.assertEqual(len({r['order_id'] for r in orders}),2490)

if __name__=='__main__':unittest.main()
