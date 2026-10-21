"""Reproducible real-data fixture. Download UCI archive separately; only public UK order totals are published.
Usage: python tools/prepare_uci.py /absolute/path/online-retail.zip
Optional build dependency: openpyxl==3.1.5. App runtime does not require it.
"""
import csv
import hashlib
import io
import json
import sys
import zipfile
from collections import Counter
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
START, END = date(2011, 11, 1), date(2011, 11, 30)

def prepare(archive, output):
    archive = Path(archive)
    with zipfile.ZipFile(archive) as z:
        payload = z.read('Online Retail.xlsx')
    wb = openpyxl.load_workbook(io.BytesIO(payload), read_only=True, data_only=True)
    records = wb.active.iter_rows(values_only=True)
    header = next(records)
    counters = Counter()
    invoices, locations = {}, {}
    for values in records:
        counters['source_rows'] += 1
        r = dict(zip(header, values))
        t = r['InvoiceDate']
        if not isinstance(t, datetime) or not START <= t.date() <= END or r['Country'] != 'United Kingdom':
            continue
        counters['selected_source_rows'] += 1
        invoice = str(r['InvoiceNo'])
        q, p = Decimal(str(r['Quantity'])), Decimal(str(r['UnitPrice']))
        if invoice.lower().startswith('c'):
            counters['excluded_cancellation_lines'] += 1; continue
        if q <= 0:
            counters['excluded_nonpositive_quantity_lines'] += 1; continue
        if p <= 0:
            counters['excluded_nonpositive_price_lines'] += 1; continue
        key = (t.date().isoformat(), 'United Kingdom')
        if invoice in locations and locations[invoice] != key:
            raise ValueError('Invoice spans incompatible day/group')
        locations[invoice] = key
        invoices[invoice] = invoices.get(invoice, Decimal(0)) + q*p
        counters['included_lines'] += 1
    wb.close()
    output.mkdir(parents=True, exist_ok=True)
    daily, orders = {}, []
    for invoice, amount in sorted(invoices.items()):
        rounded = amount.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
        if rounded != amount: counters['invoice_amounts_rounded_to_2dp'] += 1
        key = locations[invoice]
        orders.append({'order_id':invoice, 'date':key[0], 'channel':key[1], 'revenue':str(rounded)})
        row = daily.setdefault(key, {'date':key[0], 'channel':key[1], 'orders':0, 'revenue':Decimal(0)})
        row['orders'] += 1; row['revenue'] += rounded
    for name, rows, columns in [('uci-orders-nov2011.csv',orders,['order_id','date','channel','revenue']),
                                ('uci-daily-nov2011.csv',list(sorted(daily.values(),key=lambda r:r['date'])),['date','channel','orders','revenue'])]:
        with (output/name).open('w',encoding='utf-8',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=columns);writer.writeheader();writer.writerows(rows)
    total=sum((r['revenue'] for r in daily.values()),Decimal(0))
    selected=sum((r['revenue'] for r in daily.values() if '2011-11-24' <= r['date'] <= '2011-11-30'),Decimal(0))
    previous=sum((r['revenue'] for r in daily.values() if '2011-11-17' <= r['date'] <= '2011-11-23'),Decimal(0))
    manifest={
      'title':'UCI Online Retail · UK November 2011',
      'citation':'Chen, D. (2015). Online Retail [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5BW33',
      'source_url':'https://archive.ics.uci.edu/dataset/352/online+retail',
      'download_url':'https://archive.ics.uci.edu/static/public/352/online+retail.zip',
      'license':'CC BY 4.0', 'license_url':'https://creativecommons.org/licenses/by/4.0/',
      'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
      'workbook_sha256':hashlib.sha256(payload).hexdigest(),
      'period':{'start':START.isoformat(),'end':END.isoformat()}, 'currency':'GBP',
      'group':'Country = United Kingdom; region, not acquisition channel',
      'transform':'Select UK rows in November 2011; exclude C-prefixed cancellations, nonpositive quantity and price; sum Quantity*UnitPrice per InvoiceNo, round half up to 2dp per invoice; count each invoice once per day. No customer IDs or product descriptions retained. Missing calendar days are not filled in this file.',
      'meaning':'Positive invoiced sales only; payment status unknown; excludes returns, not net revenue or verified paid GMV. Historical public data, not user business data.',
      'counts':dict(counters), 'order_count':len(orders), 'daily_rows':len(daily),
      'gold':{'total_sales_gbp':str(total),'current_7d_sales_gbp':str(selected),'previous_7d_sales_gbp':str(previous)},
      'files':{name:hashlib.sha256((output/name).read_bytes()).hexdigest() for name in ['uci-orders-nov2011.csv','uci-daily-nov2011.csv']}
    }
    (output/'uci-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'order_count':len(orders),'daily_rows':len(daily),'gold':manifest['gold'],'counts':dict(counters)},ensure_ascii=False))

if __name__ == '__main__':
    prepare(sys.argv[1], ROOT/'dist/datasets')
