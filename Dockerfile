FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements-server.txt ./
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements-server.txt
COPY dist ./dist
COPY opspilot ./opspilot
COPY tools/analyze.mjs ./tools/analyze.mjs
RUN groupadd --gid 10001 opspilot && useradd --uid 10001 --gid 10001 --no-create-home opspilot
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8501
HEALTHCHECK --interval=30s --timeout=3s CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8501/api/health',timeout=2)"
CMD ["/opt/venv/bin/gunicorn", "--bind", "0.0.0.0:8501", "--workers", "1", "--threads", "4", "--timeout", "90", "--worker-tmp-dir", "/tmp", "opspilot.wsgi:create_app()"]
