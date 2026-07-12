def list_public_rds_instances(rds_client):
    """Flags RDS instances with PubliclyAccessible=True - these are reachable
    directly from the internet if their security group also allows it."""
    findings = []

    paginator_available = hasattr(rds_client, "get_paginator")
    instances = []

    if paginator_available:
        paginator = rds_client.get_paginator("describe_db_instances")
        for page in paginator.paginate():
            instances.extend(page.get("DBInstances", []))
    else:
        instances = rds_client.describe_db_instances().get("DBInstances", [])

    for db in instances:
        if db.get("PubliclyAccessible"):
            findings.append({
                "type": "RDSPubliclyAccessible",
                "resource": db.get("DBInstanceIdentifier"),
                "severity": "critical",
                "details": f"Engine: {db.get('Engine')}, PubliclyAccessible: true",
            })

    return findings


def list_unencrypted_rds_instances(rds_client):
    """Flags RDS instances without storage encryption enabled."""
    findings = []

    paginator_available = hasattr(rds_client, "get_paginator")
    instances = []

    if paginator_available:
        paginator = rds_client.get_paginator("describe_db_instances")
        for page in paginator.paginate():
            instances.extend(page.get("DBInstances", []))
    else:
        instances = rds_client.describe_db_instances().get("DBInstances", [])

    for db in instances:
        findings.append({
            "instance": db.get("DBInstanceIdentifier"),
            "encrypted": bool(db.get("StorageEncrypted")),
            "engine": db.get("Engine"),
        })

    return findings
