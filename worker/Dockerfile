FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 MIGRATIONS_DIR=/app/migrations
COPY worker/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --system --uid 10001 sentinel
COPY worker ./
COPY gateway/migrations ./migrations
USER sentinel
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s CMD python healthcheck.py
CMD ["python", "worker.py"]
