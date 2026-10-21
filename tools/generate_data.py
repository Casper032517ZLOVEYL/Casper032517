"""Synthetic daily/channel funnel; no real users, no external business claims."""
import csv,random,datetime,pathlib
root=pathlib.Path(__file__).resolve().parents[1];rng=random.Random(20260922)
rows=[]
for day in range(42):
    date=datetime.date(2026,8,1)+datetime.timedelta(days=day)
    for ch,base,ctr,cvr,aov in [('抖音',62000,.041,.19,168),('小红书',33000,.053,.25,198),('搜索广告',41000,.064,.31,178),('自然流量',28000,.072,.36,158)]:
        recent=day>=35;impressions=round(base*rng.uniform(.92,1.08)*(1.18 if recent and ch=='抖音' else 1))
        clicks=round(impressions*ctr*rng.uniform(.94,1.06));regs=round(clicks*cvr*(.60 if recent and ch=='抖音' else .93 if recent else 1))
        orders=round(regs*.29*rng.uniform(.96,1.04));rev=round(orders*aov*(.92 if recent else 1),2)
        cost=round(clicks*(1.9 if ch=='抖音' else 1.55 if ch=='小红书' else 2.1 if ch=='搜索广告' else 0),2)
        rows.append([str(date),ch,impressions,clicks,regs,orders,rev,cost])
with (root/'dist/sample.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f);w.writerow(['date','channel','impressions','clicks','registrations','orders','revenue','cost']);w.writerows(rows)
print(f'Generated {len(rows)} synthetic rows, seed=20260922')
