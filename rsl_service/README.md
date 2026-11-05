# Internal RSL service

Long-running Python HTTP service around `rsl_engine`. It is internal-only: do not
publish its port through Caddy or the public internet.

```bash
PYTHONPATH=rsl_engine/src python -m rsl_service.server
curl -s localhost:8001/health
curl -s -X POST localhost:8001/estimate \
  -H 'content-type: application/json' \
  -d '{"elapsedHours":20,"sampleStatus":"NOT_SPOILED","storageCondition":"DRY"}'
```

The service loads the frozen reference once per process and performs no fitting,
training, or network calls. `SAMPLE_REPORTED_SPOILED` and `SPOILED` are both
accepted; the canonical engine vocabulary is preserved in the response.
