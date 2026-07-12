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


# Ports that are almost never safe to expose to the entire internet.
RISKY_PORTS = {
    21: "FTP",
    22: "SSH",
    23: "Telnet",
    445: "SMB",
    1433: "MSSQL",
    3306: "MySQL",
    3389: "RDP",
    5432: "PostgreSQL",
    5900: "VNC",
    6379: "Redis",
    9200: "Elasticsearch",
    11211: "Memcached",
    27017: "MongoDB",
}

# Ports where public exposure is often intentional (a public web server) -
# still worth surfacing, but not alarming by default.
WEB_PORTS = {80, 443}

WORLD_CIDRS = {"0.0.0.0/0", "::/0"}


def _open_to_world_cidrs(perm):
    """Return the world-open CIDRs (v4/v6) referenced by this permission."""
    cidrs = []
    for r in perm.get("IpRanges", []):
        if r.get("CidrIp") in WORLD_CIDRS:
            cidrs.append(r["CidrIp"])
    for r in perm.get("Ipv6Ranges", []):
        if r.get("CidrIpv6") in WORLD_CIDRS:
            cidrs.append(r["CidrIpv6"])
    return cidrs


def _classify_permission(perm):
    """Decide severity + title + description for one open permission.
    Returns (severity, title, description) or None if nothing risky."""
    protocol = perm.get("IpProtocol")
    from_port = perm.get("FromPort")
    to_port = perm.get("ToPort")

    # IpProtocol "-1" (or missing port bounds) means ALL protocols/ports.
    if protocol == "-1" or (from_port is None and to_port is None):
        return (
            "critical",
            "All ports and protocols open to the internet",
            "Every port and protocol on this security group is reachable from anywhere on the internet.",
        )

    if from_port is None or to_port is None:
        from_port = to_port = from_port if from_port is not None else to_port

    matched_risky = sorted(p for p in RISKY_PORTS if from_port <= p <= to_port)
    if matched_risky:
        services = ", ".join(f"{RISKY_PORTS[p]} ({p})" for p in matched_risky)
        return (
            "critical",
            f"Sensitive service exposed: {services}",
            f"Port(s) for {services} are reachable from anywhere on the internet.",
        )

    port_span = to_port - from_port
    if port_span >= 1000:
        return (
            "medium",
            f"Wide port range open: {from_port}-{to_port}",
            f"Ports {from_port}-{to_port} are reachable from anywhere on the internet - unusually broad for a single rule.",
        )

    matched_web = sorted(p for p in WEB_PORTS if from_port <= p <= to_port)
    if matched_web and from_port == to_port:
        return (
            "low",
            f"Web port {from_port} open to the internet",
            f"Port {from_port} is reachable from anywhere - expected for a public-facing web server, but confirm that's intentional.",
        )

    if from_port == to_port:
        return (
            "medium",
            f"Port {from_port} open to the internet",
            f"Port {from_port} ({protocol}) is reachable from anywhere on the internet.",
        )

    return (
        "medium",
        f"Ports {from_port}-{to_port} open to the internet",
        f"Ports {from_port}-{to_port} ({protocol}) are reachable from anywhere on the internet.",
    )


def check_open_security_groups(ec2_client):
    """Flags security group rules open to the entire internet, with
    severity AND title/description based on *which* ports are exposed -
    SSH open to the world is not the same risk as a public web server's
    port 443, and the finding should say so, not just "critical" either way."""
    findings = []

    response = ec2_client.describe_security_groups()

    for sg in response.get("SecurityGroups", []):
        for perm in sg.get("IpPermissions", []):
            world_cidrs = _open_to_world_cidrs(perm)
            if not world_cidrs:
                continue

            classification = _classify_permission(perm)
            if not classification:
                continue

            severity, title, description = classification
            findings.append({
                "type": "SecurityGroupOpen",
                "resource": sg.get("GroupId"),
                "severity": severity,
                "title": title,
                "details": f"{description} (open to {', '.join(world_cidrs)})",
            })

    return findings
