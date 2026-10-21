# 运行与受控部署 · 1.2

## 三种运行方式

|方式|适用|数据与模型|
|---|---|---|
|现有私有在线工作台|无需安装，单人上传真实报表|计算在浏览器，刷新清空，不调用模型|
|`python server.py`|本人本机，Python3.11+、Node20+|默认浏览器计算；配置并授权后调用本地模型服务|
|Gunicorn / Docker|受控小团队试点|Basic登录、Host白名单、来源检查；配置模型后仍需界面勾选授权|

`server.py`使用Python http.server作为开发入口；部署使用`opspilot.wsgi:create_app()`，不要将开发入口直接作为公网服务。

## Linux Gunicorn

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-server.txt
cp .env.example .env
```

编辑`.env`，至少填写`OPSPILOT_ACCESS_USER`和自己生成的12位以上强密码`OPSPILOT_ACCESS_PASSWORD`。不能把.env提交GitHub。程序在凭据缺失/过短时拒绝启动，密码不会写入静态前端或API配置响应。

```bash
gunicorn --bind 127.0.0.1:8501 --workers 1 --threads 4 --timeout 90 'opspilot.wsgi:create_app()'
```

浏览器访问http://127.0.0.1:8501会出现HTTP Basic登录。分析请求最多8 MB、20,000行、500字符；同时最多4个工具分析。数据不写数据库、文件或访问日志，只有用户手动导出文件保存在自己的下载目录。

当前固定依赖Gunicorn26.2.0，实际通过了本机Gunicorn进程的HTTP冒烟测试。自动测试命令：

```bash
python tests/smoke_gunicorn.py
```

该测试启动随机端口，用一次性生成的测试密码核对健康、登录、静态页面和公开真实交易分析，不需要付费API。

## Docker Compose

```bash
cp .env.example .env
# 编辑账号/强密码；需要模型时配置模型信息。
docker compose up --build -d
```

默认只映射本机127.0.0.1:8501；非root用户、只读根文件系统、临时目录、512MB内存上限，无数据卷。可用`docker compose down`停止。**当前执行环境没有Docker，因此镜像构建和Compose启动未实际验证**；已验证相同WSGI入口和固定Gunicorn版本的真实HTTP行为。

## 有域名的服务

在受控服务器上由HTTPS反向代理接入Gunicorn，保持Gunicorn仅监听loopback。配置`OPSPILOT_TRUSTED_HOSTS=你的真实域名`，代理须保留Host；静态页面会自动探测同源`/api/config`，支持自定义域名。Basic凭据只能经过HTTPS传输（本机loopback调试除外）。

代理需要限制请求体8MB、缓冲慢请求、设置IP级登录/分析限流，并令响应超时大于模型超时；全量请求最长90秒。不要为修复域名错误改成通配Host或关掉认证。

此部署入口为共享账号小团队试点：尚无SSO、逐用户权限、审计记录、密码找回或租户隔离。共享账号难以追踪个人操作，需要这些能力时再扩展身份与数据层。没有持久化项目/报表历史是有意的隐私取舍；不宣称已经完成企业级生产验收。

## 模型

只配置密钥不会自动发送数据。用户在当前页面勾选授权后，浏览器才把标准日汇总发给同源API；API只把问题、分组名、聚合证据、币种和口径发给配置的模型。模型不能改变计算或执行代码；失败回退到原计算。

未对接用户付费密钥；现有API测试使用本地模拟服务。上线前用真实问题核对模型忠实度、成本与延迟，参见HUMAN_EVAL.md。
