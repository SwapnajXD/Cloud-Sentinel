"""Conservative resource-policy analysis; no function is invoked by the scanner.
Sources: docs.aws.amazon.com/lambda/latest/dg/urls-auth.html and lambda-runtimes.html.
"""
import fnmatch
import json
from datetime import date
from scans.common import check, guarded, inventory, absent

# Maintained snapshot, not a live AWS support feed. Unknown/custom runtimes are skipped.
RUNTIME_REVIEWED = '2026-09-10'
DEPRECATED_RUNTIMES = {
    'nodejs', 'nodejs4.3', 'nodejs6.10', 'nodejs8.10', 'nodejs10.x', 'nodejs12.x',
    'nodejs14.x', 'nodejs16.x', 'nodejs18.x', 'nodejs20.x', 'python2.7', 'python3.6',
    'python3.7', 'python3.8', 'python3.9', 'dotnetcore1.0', 'dotnetcore2.0',
    'dotnetcore2.1', 'dotnetcore3.1', 'dotnet6', 'ruby2.5', 'ruby2.7', 'go1.x',
}
DEPRECATION_DATES = {'python3.10': '2026-10-31', 'python3.11': '2027-06-30',
                     'python3.12': '2028-10-31', 'python3.13': '2029-06-30',
                     'nodejs22.x': '2027-04-30', 'nodejs24.x': '2028-04-30'}


def values(value):
    return value if isinstance(value, list) else [value]


def public_statement(statement, arn, action, url=False):
    """True=unrestricted matching grant, None=requires policy evaluation, False=no grant."""
    principal = statement.get('Principal')
    public = principal == '*' or isinstance(principal, dict) and '*' in values(principal.get('AWS'))
    if not public or statement.get('Effect') != 'Allow':
        return False
    if 'NotAction' in statement or 'NotResource' in statement:
        return None
    if not any(isinstance(a, str) and fnmatch.fnmatchcase(action.lower(), a.lower()) for a in values(statement.get('Action', []))):
        return False
    if not any(isinstance(r, str) and fnmatch.fnmatchcase(arn, r) for r in values(statement.get('Resource', []))):
        return False
    conditions = statement.get('Condition', {})
    if not conditions:
        return True
    # These two conditions constrain invocation mechanism, not the audience of a NONE URL.
    allowed = {'StringEquals': {'lambda:FunctionUrlAuthType': ['NONE']},
               'Bool': {'lambda:InvokedViaFunctionUrl': ['true', True]}}
    if url and all(op in allowed and isinstance(fields, dict) and fields and
                   all(key in allowed[op] and all(v in allowed[op][key] for v in values(value))
                       for key, value in fields.items()) for op, fields in conditions.items()):
        return True
    return None


def scan(clients, region):
    client = clients['lambda']
    findings = []
    for function in inventory(client, 'list_functions', 'Functions'):
        name = function['FunctionName']
        arn = function['FunctionArn']
        runtime = function.get('Runtime')
        if runtime in DEPRECATED_RUNTIMES or runtime in DEPRECATION_DATES and date.today().isoformat() >= DEPRECATION_DATES[runtime]:
            status = 'FAIL'
        elif runtime in DEPRECATION_DATES:
            status = 'PASS'
        else:
            status = 'SKIPPED'
        findings.append(check('LambdaDeprecatedRuntime', 'Lambda', name, status, 'Lambda runtime support',
                              f'Runtime: {runtime or "container/custom"}. Catalog reviewed {RUNTIME_REVIEWED}; unknown runtimes require manual review.',
                              'Review AWS runtime support dates and upgrade deprecated runtimes.', severity='medium', region=region))
        def permissions():
            try:
                policy = json.loads(client.get_policy(FunctionName=name)['Policy'])
            except Exception as error:
                if not absent(error, 'ResourceNotFoundException'):
                    raise
                policy = {'Statement': []}
            statements = values(policy.get('Statement', []))
            has_deny = any(s.get('Effect') == 'Deny' for s in statements)
            direct = [public_statement(s, arn, 'lambda:InvokeFunction') for s in statements]
            direct_state = 'UNKNOWN' if has_deny or None in direct else 'FAIL' if True in direct else 'PASS'
            result = [check('LambdaPublicInvokePermission', 'Lambda', name, direct_state, 'Lambda public invoke policy',
                            'Unrestricted matching public InvokeFunction grant.' if direct_state == 'FAIL' else
                            'Conditional or deny policy requires manual evaluation.' if direct_state == 'UNKNOWN' else 'No unrestricted public InvokeFunction grant found.',
                            'Restrict invoke permissions to intended principals. Review conditions and explicit denies.', region=region)]
            def function_url():
                try:
                    url = client.get_function_url_config(FunctionName=name)
                except Exception as error:
                    if not absent(error, 'ResourceNotFoundException'):
                        raise
                    return [check('LambdaPublicFunctionURL', 'Lambda', name, 'SKIPPED', 'Lambda Function URL', 'No Function URL configured.', region=region)]
                if url['AuthType'] == 'AWS_IAM':
                    state = 'PASS'
                    evidence = 'Function URL requires IAM authentication.'
                else:
                    grants = [[public_statement(s, arn, action, url=True) for s in statements]
                              for action in ('lambda:InvokeFunctionUrl', 'lambda:InvokeFunction')]
                    state = 'UNKNOWN' if has_deny or any(None in group for group in grants) else 'FAIL' if all(True in group for group in grants) else 'UNKNOWN'
                    evidence = 'AuthType=NONE. ' + ('Both public URL invocation grants are present.' if state == 'FAIL' else 'Public invocation cannot be established from this policy; review both required grants and conditions.')
                return [check('LambdaPublicFunctionURL', 'Lambda', name, state, 'Lambda Function URL access', evidence,
                                    'Use AWS_IAM authentication or restrict public invocation permissions.', region=region)]
            result.extend(guarded('LambdaPublicFunctionURL', 'Lambda', name, region, function_url))
            return result
        findings.extend(guarded('LambdaPublicAccess', 'Lambda', name, region, permissions))
    return findings
