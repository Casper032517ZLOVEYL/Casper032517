# API · 1.2

开发：`python server.py`，loopback8501，无认证。受控部署：`opspilot.wsgi:create_app()`，Gunicorn，Basic认证、可信Host与HTTPS代理；见DEPLOYMENT.md。两者共用`http_api.py`验证及Node计算引擎。

## 端点

- `GET /api/health`：`{"ok":true,"version":"1.2.0"}`。部署入口健康探测不需登录，返回无业务信息。
- `GET /api/config`：`ai`表示配置是否可用，不代表获准发送；另含version与max_rows，不返回凭据。
- `POST /api/analyze`：JSON，最多8MB/20,000标准行/500字问题/4个并发。

部署入口除health外要求Basic登录。Host白名单不匹配421，缺少/错误登录401，跨Origin403，体积413，非JSON415，忙429，格式400，未知404。业务口径/缺失问题返回200且ok=false。

## 请求

```json
{
  "question":"销售金额趋势",
  "channel":null,
  "use_model":false,
  "dataset":{"version":1,"currency":"GBP","revenueBasis":"gross","strictFunnel":false,"mode":"daily","zeroFilled":0},
  "range":{"start":"2011-11-01","end":"2011-11-01"},
  "rows":[{"date":"2011-11-01","channel":"United Kingdom","revenue":100.00,"orders":2}]
}
```

示例为接口格式说明，数字不是公开案例gold。`rows`是经过导入映射的**日×分组标准行**，不是原始订单明细；浏览器适配器负责去重、汇总、状态筛选和质量报告。API不会自动猜字段或支付状态。

- dataset.version=1启用可缺字段模式，货币限CNY/GBP/USD/EUR/JPY/HKD，revenueBasis限gross/paid。未提供的数值字段为null，该指标的必要字段缺失时拒绝分析。
- 不提供dataset沿用1.1严格模式：完整八字段、同漏斗，默认CNY。仅保留为程序兼容路径。
- channel可省略/null表示全分组；与问题中真实分组名冲突时拒绝。
- range可省略/null表示问题中的最近N天（默认7天），锚定整份数据最大日期；自选范围须1–90天，比较前一等长窗口。问题显式天数若冲突会拒绝。
- use_model默认false且必须布尔。只有true及服务端配置可用时，才允许一次外部模型调用。
- 仅接受固定指标和任务，不能通过请求传代码/SQL或更改计算函数。

## 响应

`ok/error`、`currency/data_contract`、`plan/range`、`current/previous/delta/relative`、`details/ranking/trend`、`evidence/formula/knowledge`、`ai_status/usage/cost_usd`、`latency_ms/total_latency_ms/request_id`。

缺失字段的evidence保持null；零分母值为null；趋势/排名不提供不完整前期。相对变化是比例（-0.1表示下降10%），比率delta是比例差（0.01表示1个百分点）。

ai_status：disabled=无配置/未授权/口径查询；complete=假设格式及引用ID通过；fallback=模型失败，仍保留真实计算。没有实际Token与单价时不填零费用。

应用不存储上传报表、问题或模型响应。线上代理应关闭含敏感查询/请求体的日志，并配置限流。用户自己点击下载的文件、浏览器反馈仍需用户妥善管理。
