FROM python:3.11-slim

WORKDIR /app

# ✅ System dependencies (Postgres driver)
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1

# ✅ Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ✅ Copy worker code
COPY . .

# ✅ Start worker
CMD ["python", "worker.py"]