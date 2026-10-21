# 本地 API

默认端口8501。无第三方Python运行依赖；需要Node20+。本服务面向个人本机使用，未提供多用户认证。

## GET /api/health

返回 `{"ok":true,"version":"1.1.0"}`。

## GET /api/config

返回AI是否已配置、版本和行数限制；不返回密钥或端点凭据。

## POST /api/analyze

Content-Type: application/json。最大8 MB、20,000行、500字问题。最多4个并发分析；超过限制返回429。外部Origin与本机Host不匹配时返回403。

```json
{
  "question": "最近7天 GMV 为什么下降？",
  "channel": "抖音",
  "rows": []
}
```

`rows`必须按数据契约填入完整记录；示例中的空数组不构成有效分析。channel可省略/null代表全部渠道，也可以从问题中识别真实渠道名；二者冲突时拒绝。

响应主要字段：`ok`、`error`（失败时）、`plan`、`range`、`current`、`previous`、`delta`、`relative`、`details`、`trend`、`ranking`、`knowledge`、`evidence`、`ai_status`、`usage`、`cost_usd`、`latency_ms`、`total_latency_ms`、`request_id`。

- `ai_status=disabled`：没有配置模型或口径查询无需模型。
- `complete`：结构化假设通过格式与引用ID校验。
- `fallback`：模型/响应校验失败，保留真实计算结果。

业务数据错误返回HTTP200且`ok=false`，以便页面显示具体问题。请求格式/长度/来源错误使用400/413/415/403；未知接口404。

不记录问题、上传记录、模型响应或密钥。没有自动化执行预算、写数据库或执行用户代码的接口。
