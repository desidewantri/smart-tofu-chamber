FROM python:3.11-slim

WORKDIR /app
COPY rsl_engine /app/rsl_engine
COPY rsl_service /app/rsl_service
RUN python -m pip install --no-cache-dir /app/rsl_engine

ENV PYTHONUNBUFFERED=1 RSL_HOST=0.0.0.0 RSL_PORT=8001
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=2)"
CMD ["python", "-m", "rsl_service.server"]
