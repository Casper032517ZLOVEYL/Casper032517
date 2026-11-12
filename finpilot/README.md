# FinPilot · 有证据的投研任务 Agent

**上传财务指标与报告，执行多步研究任务，查看每一步计算、证据和信息缺口。**

基础版 **0.1.0**，个人作品集项目，AI辅助开发。源码公开，运行在本机。无需密钥即可体验规则流程；配置自己的兼容模型后，可运行按工具反馈选择后续行动的 Agent。

[产品定义](docs/PRODUCT.md) · [架构与工具协议](docs/ARCHITECTURE.md) · [演示与面试讲解](docs/DEMO.md) · [评测协议](evaluation/README.md) · [数据来源](examples/SOURCES.md)

## 立即运行

需要Python **3.11+**，无需Node或前端构建。

```bash
git clone https://github.com/Casper032517ZLOVEYL/Casper032517.git
cd Casper032517/finpilot
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows PowerShell改用：.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server.py
```

打开 **http://127.0.0.1:8510**。点击“载入 Apple 公开样例”→“开始研究”→查看研究简报、证据资料和执行记录。若仅使用CSV/TXT/MD，安装依赖可省略；pypdf仅用于PDF。

这是现有OpsPilot仓库中的**独立子项目**，从本目录运行，不使用仓库根目录的server.py。GitHub展示源码与文档，不托管Python服务；复制链接给别人，他们可以下载运行。

## 已实现

|能力|基础版行为|
|---|---|
|导入|CSV指标，PDF/TXT/MD原文；单文件5MB、总计10MB、最多6文件|
|口径检查|重复记录、币种/单位冲突、异常数值、缺失字段；失败保留旧资料|
|确定性计算|营收、净利润、经营现金流、上年同期同比和净利率|
|文档检索|按英文词/中文双字匹配；返回文件名、页码和片段ID|
|离线流程|规则编排的指标分析与资料检索；不声称自主规划|
|模型Agent|JSON动作协议，最多8次模型调用，按结果选择工具、补查、结束|
|多轮追问|当前资料保留，最近4轮问题与回答摘要进入模型上下文|
|证据检查|模型结论需引用本轮工具已返回的ID，未知引用拦截|
|失败处理|工具错误反馈给模型；超时/轮次耗尽时保留计算与执行记录|
|变化跟踪|手动导出快照，下次导入后比较新增期间、改值、口径变化|
|交付|Markdown报告、完整执行JSON、数据快照JSON|

## 导入自己的数据

CSV必须使用UTF-8编码，一行一个公司和财务期间；最多500行。请先手工核对数据与财报口径。

```csv
company,period,currency,unit,revenue,net_income,operating_cash_flow,source,location
Example,FY2023,USD,million,100,10,20,https://example.com/report,annual figures
Example,FY2024,USD,million,120,15,18,https://example.com/report,annual figures
```

上面是**合成格式示例**，与真实Apple样例分开。`source`和`location`可选；其余列必须存在，但数值可留空，缺失不补零。

- `period`：FY2024为公司财年全年；FY2024-Q1为公司财年单季度。**不接受累计年初至今值**。同一公司各年财年定义、合并范围与会计口径须由导入者确认。
- `currency`：USD、CNY等三位大写代码；`unit`：one / thousand / million。
- 同一公司币种和单位须统一；同公司同期间重复直接阻止导入，避免混入不同版本或重述数据。
- 金额为绝对值不超过1e18、最多6位小数的有限数值，不接受千位分隔符。
- 同比只匹配上年**相同季度或年度**，不把环比当同比。前期缺失、为零或为负时不计算常规百分比。
- **上传PDF不自动识别财务表格。** PDF用于检索证据，需文本版、未加密、不超过100页/30万字符；扫描件需先OCR，大报告请拆分。
- 一次上传替换整套资料、清空追问摘要。若需指标与原文联合分析，请同时选择CSV和PDF。

## 可选：接入真实模型

将本目录`.env.example`复制为`.env`，填写服务商提供的**当前可用模型ID**和密钥，然后重启服务：

```dotenv
FINPILOT_API_KEY=自己的密钥
FINPILOT_MODEL=服务商控制台的模型ID
FINPILOT_BASE_URL=https://api.deepseek.com
```

也可使用支持`POST /chat/completions`和`response_format: {"type":"json_object"}`的兼容HTTPS端点。base URL不含`/chat/completions`，如端点要求`/v1`则自行保留该路径。端点不允许重定向，防止Authorization跨目标传递。模型不兼容JSON模式时会明确失败，不回退成伪造结果。

界面选择“模型 Agent”，确认数据发送范围后执行。模型通过受限JSON动作协议选择工具；**不是提供商原生function calling**，也没有浏览器操作或任意代码执行。

发送范围：当前问题、最近4轮问答摘要、工具返回的公司名称、计算结果、财务记录及检索片段（可能包含文件名）。密钥仅在服务器环境中；不会返回浏览器。只有勾选同意并运行模型模式后才发送；离线模式不调用模型。

最多8次模型调用，每次20秒网络超时；90秒软任务预算在调用间检查，进行中的调用可能使总时长接近110秒。每轮最多1800输出token。Token用量仅累加服务商实际返回的值，`reported_calls`表示有用量信息的调用数；未报告部分未知，费用为null，不估算成已知费用。没有自动重试计费请求。

## 真实公开样例

内置Apple FY2023/FY2024的GAAP全年数据，单位为百万美元，来自Apple官方2024年第四季度财务表的第1、3页，并非最新数据。

|财年|营业收入|净利润|经营现金流|
|---|---:|---:|---:|
|FY2023|383,285|96,995|110,543|
|FY2024|391,035|93,736|118,254|

FY2024对应同比约 **+2.0220%、−3.3600%、+6.9756%**，净利率 **23.9713%**。CSV内保留原始来源及位置；程序不自动下载远端报告。[查看原始资料与口径](examples/SOURCES.md)。

## 验证

从本目录运行：

```bash
python -m unittest discover -s tests -v
```

已在Python3.12运行30项检查，覆盖财务计算、季度/年度边界、缺失与重复、PDF文本提取、受限工具循环、伪造引用、失败保留、快照差异和真实本地HTTP会话隔离。

模型行为测试使用脚本客户端和模拟HTTP返回，**没有进行真实付费模型质量评测，也没有真实用户留存或效率提升数据**。`evaluation/`提供下一阶段人工任务评测清单；自动检查通过不能称为投研准确率。浏览器视觉与点击验收在当前环境受限，尚未完成；HTML/JS语法和本地HTTP已检查。

## 能力边界

- 引用校验只证明ID存在；模型可能误读证据或生成错误数值。界面将模型内容标为待复核，指标卡片始终使用程序计算结果。
- 离线模式不理解任意任务，仅提供固定范围的计算与检索；多轮意图理解需要模型。
- 不接入实时行情、联网检索、SEC自动同步、自动调度、通知发送或交易。跟踪功能需要用户重新导入并手动比较。
- 没有财年终点自动对齐、汇率转换、估值、行业专用会计规则或自动因果判断。
- 本地开发服务仅绑定127.0.0.1，**不要作为公网生产服务部署**。没有账号体系、多租户、数据库、任务队列或生产审计。
- 上传资料与最近4轮摘要保存在本进程内存，不写磁盘；清空、进程退出或2小时闲置后清除。浏览器会话使用HttpOnly/SameSite Cookie。导出文件由用户自行保存，不会自动同步GitHub。

## 项目结构

```text
server.py                 本地HTTP入口、会话与同源检查
finpilot/data.py          数据契约、CSV与文档解析
finpilot/engine.py        Decimal计算、检索与只读工具
finpilot/agent.py         JSON行动循环、预算与结果校验
finpilot/service.py       导入、分析、上下文与快照
web/                      无构建依赖的中文工作台
examples/                 有来源的公开数据
tests/                    自动回归
evaluation/               人工任务评测协议
docs/                     产品设计、架构和演示说明
```

代码与项目文档使用[MIT许可](LICENSE)。Apple公司名称及第三方原始报告不属于本项目；只附必要数值与来源链接，不打包第三方报告全文。
