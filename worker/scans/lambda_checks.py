import json


# Runtimes AWS has deprecated / stopped patching. Not exhaustive, but
# covers the common ones people forget to upgrade off of.
DEPRECATED_RUNTIMES = {
    "nodejs", "nodejs4.3", "nodejs6.10", "nodejs8.10",
    "nodejs10.x", "nodejs12.x", "nodejs14.x",
    "python2.7", "python3.6", "python3.7",
    "dotnetcore1.0", "dotnetcore2.0", "dotnetcore2.1", "dotnetcore3.1",
    "ruby2.5", "ruby2.7",
    "go1.x",
}


def _list_all_functions(lambda_client):
    functions = []
    if hasattr(lambda_client, "get_paginator"):
        paginator = lambda_client.get_paginator("list_functions")
        for page in paginator.paginate():
            functions.extend(page.get("Functions", []))
    else:
        functions = lambda_client.list_functions().get("Functions", [])
    return functions


def list_public_lambda_functions(lambda_client):
    """Flags Lambda functions reachable without authentication: either a
    Function URL with AuthType=NONE, or a resource-based policy that lets
    any AWS principal invoke the function."""
    findings = []

    for fn in _list_all_functions(lambda_client):
        name = fn.get("FunctionName")

        try:
            url_config = lambda_client.get_function_url_config(FunctionName=name)
            if url_config.get("AuthType") == "NONE":
                findings.append({
                    "type": "LambdaPublicFunctionURL",
                    "resource": name,
                    "severity": "critical",
                    "details": (
                        f"Function URL {url_config.get('FunctionUrl', '')} "
                        "allows unauthenticated invocation (AuthType: NONE)"
                    ),
                })
        except Exception:
            pass  # no function URL configured - not an error, just nothing to flag

        try:
            policy_resp = lambda_client.get_policy(FunctionName=name)
            policy = json.loads(policy_resp.get("Policy", "{}"))
            for stmt in policy.get("Statement", []):
                principal = stmt.get("Principal")
                is_public = principal == "*" or (
                    isinstance(principal, dict) and principal.get("AWS") == "*"
                )
                if is_public and stmt.get("Effect") == "Allow":
                    findings.append({
                        "type": "LambdaPublicInvokePermission",
                        "resource": name,
                        "severity": "critical",
                        "details": "Resource policy allows any AWS principal to invoke this function",
                    })
                    break  # one finding per function is enough
        except Exception:
            pass  # no resource policy - not an error, just nothing to flag

    return findings


def check_deprecated_lambda_runtimes(lambda_client):
    """Flags functions running on a runtime AWS no longer patches."""
    findings = []

    for fn in _list_all_functions(lambda_client):
        runtime = fn.get("Runtime")
        if runtime and runtime in DEPRECATED_RUNTIMES:
            findings.append({
                "type": "LambdaDeprecatedRuntime",
                "resource": fn.get("FunctionName"),
                "severity": "medium",
                "details": f"Running on {runtime}, which no longer receives security patches",
            })

    return findings
