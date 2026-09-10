"""Container-local heartbeat: another healthy replica cannot mask this one."""
import os
import time
from pathlib import Path

path = Path(os.getenv('WORKER_HEARTBEAT_FILE', '/tmp/sentinel-worker-heartbeat'))
raise SystemExit(0 if path.exists() and time.time() - path.stat().st_mtime < 90 else 1)
