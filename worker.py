import os
import json
import time
import redis

REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379')

def main():
    r = redis.from_url(REDIS_URL)
    print('Worker started, listening for audit_tasks...')
    while True:
        try:
            item = r.brpop('audit_tasks', timeout=5)
            if item:
                _, payload = item
                try:
                    task = json.loads(payload)
                except Exception:
                    print('Invalid task payload:', payload)
                    continue
                print('Received task:', task)
                # TODO: implement audit logic using boto3 and save results to Postgres
            else:
                time.sleep(1)
        except Exception as e:
            print('Worker error:', e)
            time.sleep(5)

if __name__ == '__main__':
    main()
