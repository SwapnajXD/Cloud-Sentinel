import requests
import os

FLOCI_URL = os.getenv("FLOCI_URL", "http://floci:8080")

def get_floci_jobs():
    try:
        res = requests.get(f"{FLOCI_URL}/api/jobs")
        return res.json()
    except:
        return {"error": "floci not reachable"}