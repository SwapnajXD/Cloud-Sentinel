def list_unencrypted_s3_buckets(s3_client):
    buckets = s3_client.list_buckets().get("Buckets", [])
    findings = []

    for bucket in buckets:
        name = bucket["Name"]

        try:
            encryption = s3_client.get_bucket_encryption(Bucket=name)
            rules = encryption["ServerSideEncryptionConfiguration"]["Rules"]

            findings.append({
                "bucket": name,
                "encrypted": True,
                "details": rules,
            })

        except Exception:
            findings.append({
                "bucket": name,
                "encrypted": False,
                "details": "No encryption configured",
            })

    return findings


def check_public_s3_buckets(s3_client):
    findings = []

    buckets = s3_client.list_buckets().get("Buckets", [])

    for bucket in buckets:
        name = bucket["Name"]

        try:
            acl = s3_client.get_bucket_acl(Bucket=name)

            for grant in acl.get("Grants", []):
                grantee = grant.get("Grantee", {})

                if "URI" in grantee and "AllUsers" in grantee["URI"]:
                    findings.append({
                        "type": "S3PublicAccess",
                        "resource": name,
                        "severity": "critical",
                        "details": "Bucket is publicly accessible",
                    })

        except Exception:
            continue

    return findings