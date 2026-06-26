def list_running_ec2_instances(ec2_client):
    response = ec2_client.describe_instances(
        Filters=[{"Name": "instance-state-name", "Values": ["running"]}]
    )

    instances = []

    for reservation in response.get("Reservations", []):
        for instance in reservation.get("Instances", []):
            instances.append({
                "instance_id": instance.get("InstanceId"),
                "state": instance.get("State", {}).get("Name"),
                "type": instance.get("InstanceType"),
                "public_ip": instance.get("PublicIpAddress"),
            })

    return instances


def check_open_security_groups(ec2_client):
    findings = []

    response = ec2_client.describe_security_groups()

    for sg in response.get("SecurityGroups", []):
        for perm in sg.get("IpPermissions", []):
            for ip_range in perm.get("IpRanges", []):
                if ip_range.get("CidrIp") == "0.0.0.0/0":
                    findings.append({
                        "type": "SecurityGroupOpen",
                        "resource": sg.get("GroupId"),
                        "severity": "critical",
                        "details": f"Port {perm.get('FromPort')} open to the world",
                    })

    return findings