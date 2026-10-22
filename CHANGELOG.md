# 1.3.0 · 2026-10-22

- Add linked dashboard metric/group/date filters, trend, additive composition, ranking and daily calendar.
- Add searchable, sortable, paginated group table with filtered CSV export.
- Reuse validated analytics; distinguish missing prior periods, null ratios and zero totals.
- Fix chart currency labels to use the imported currency.
- Add MIT license, data attribution, security reporting guidance and dashboard documentation.
- Add 15 dashboard checks; 132 historical regressions, 73 JS checks and 50 Python checks pass locally.

# 版本记录

## 1.2.0 · 2026-10-21

- 真实CSV/TSV/XLSX字段映射；日汇总与一行一单的订单适配。
- 可缺字段、状态筛选、单币种/日期格式、显式完整性/聚合/补零与质量导出。
- 以真实UCI历史交易作为默认案例，附署名许可、SHA256与独立金额核对；移除默认合成数据。
- 自选1–90天、指标可用性提示、销售口径与货币展示。
- 修复真实Excel的浮点序列化噪声，真实三位金额仍阻止导入。
- 默认模型关闭、每次显式授权；共享HTTP验证、认证WSGI入口、Gunicorn真实HTTP检查；容器配置未实测。
- 保留历史回归，自动检查总计240项；更新PRD、数据/API/部署/真实数据文档。

# Changelog

## 1.1.0 · 2026-10-21

- 拆分口径、数据、路由、计算、图表、报告和服务端模块，保留共享计算入口。
- 支持下拉框和问题中指定渠道，使用全数据截止日防止筛选掩盖漏数。
- 增加Markdown报告、明细CSV导出和10%相对变化预警。
- 趋势与排名不再展示未经完整性校验的前期数值。
- 多指标、多窗口与渠道冲突时澄清；拒绝布尔计数、空表头和非法计划额外字段。
- 模型调用由重复计划+解释两次改为一次结构化假设，校验字段与引用ID，保留失败回退。
- 用量未知保留null；仅实际用量与完整价格配置同时存在才计算费用。
- 支持本地.env；增加HTTP来源/格式/长度限制、并发上限和健康接口。
- 增加24项JS测试与27项后端/模拟API测试，保留132项回归；旧“指定渠道应拒绝”用例随新增能力改为成功断言。
- 补齐PRD、数据契约、架构、API、人工评审协议和CI配置。

## 1.0.0 · 2026-09-22

- 初始确定性文件分析Demo、可选本地模型接口、合成数据和项目资料。
- 初始资料为个人作品设计，不代表真实访谈或业务增长；历史PDF保留在docs/archive。
