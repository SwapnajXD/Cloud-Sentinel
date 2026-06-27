import subprocess

def check_docker():
    try:
        result = subprocess.check_output(["docker", "ps"]).decode()
        return {"docker_running": True, "containers": result}
    except:
        return {"docker_running": False}


def check_disk():
    result = subprocess.check_output(["df", "-h"]).decode()
    return {"disk": result}


def run_homelab_checks():
    return {
        "docker": check_docker(),
        "disk": check_disk(),
    }