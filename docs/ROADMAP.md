# Cloud-Sentinel product roadmap

Cloud-Sentinel's direction is a persistent, read-only AWS assessment service: durable scheduled scans, scoped report history, trustworthy evidence, and actionable relationships between findings. This roadmap borrows product ideas from Cloud Custodian, Steampipe, ScoutSuite, and cloud-audit without trying to reproduce their breadth or architectures.

Estimated sequence after the previously discussed demo/CI/deployment foundation: Priority 1, 2–3 weeks; Priority 2, 2–3 weeks; Priority 3, 1–2 weeks; Priority 4, one week for a prototype and go/no-go decision. Estimates assume part-time work and should be adjusted based on actual progress.

## Priority 1 — Evidence-linked attack paths

**Reference:** cloud-audit's attack-chain and proof concepts; ScoutSuite's account snapshot model.

Turn the existing correlation rules into explicit paths through observed AWS configuration. Each path must link back to its source findings, label confidence as potential or verified, and list the conditions that remain unverified. Do not claim network reachability unless route tables, network ACLs, and other required conditions have actually been checked. The current public-EC2/open-security-group case is the first vertical slice.

**Acceptance:** the supported EC2 path shows its internet source, security group, and affected instance; each step links to its source finding; unknown or absent evidence cannot create a path; aggregate risk does not double count source failures.

**Complete (initial slice):** the EC2 SSH/RDP/all-protocol path is labeled *potential*, links to its stored evidence, and lists unverified network layers. It requires an explicit world-open CIDR and observed instance inventory. No end-to-end reachability or exploitability claim is made. Additional path types should be added only when the scanner has enough direct evidence to support their edges.

## Priority 2 — Read-only policy-as-code

**Reference:** Cloud Custodian's YAML policy model and dry-run workflow.

Let users define small, versioned policies that filter scanned resources and produce explainable findings. Start with a deliberately limited read-only language: resource type, field, operator, value, severity, and remediation text. Validate policies before saving and explain each match. Do not implement mutation or automatic remediation in this phase.

**Complete:** versioned YAML policies are stored owner-scoped, accept only the documented filter schema, and evaluate against saved reports without AWS access. Results show matched finding IDs and fields; unknown or missing evidence cannot satisfy negative filters. Policy versions cannot mutate reports or cloud resources.

## Priority 3 — Portable reports and CI integration

**Reference:** ScoutSuite's offline HTML report and cloud-audit's JSON/SARIF outputs.

Export a self-contained report bundle that can be viewed without a running Cloud-Sentinel instance. Add SARIF output for supported findings so scan results can be consumed by code-hosting security workflows. Preserve account scope, scan time, evidence status, and limitations in exports.

**Acceptance:** exported artifacts open offline, contain no credential-like fields, preserve `UNKNOWN`/`SKIPPED`, and round-trip through documented schemas. SARIF has stable rule and finding identifiers and marks partial coverage clearly.

**Complete:** report pages export sanitized JSON and a self-contained HTML report. The owner-scoped SARIF 2.1.0 endpoint preserves scope, scan times, coverage, incompleteness, unknown/skipped findings, and stable identifiers. The API guide includes a CI download example.

## Priority 4 — Query experience (prototype only)

**Reference:** Steampipe's SQL interface over cloud data.

First prototype queries over saved Cloud-Sentinel report snapshots, not live AWS APIs. Evaluate whether a small CLI or embedded query interface solves real user questions before adding a new runtime or plugin system.

**Acceptance:** a prototype answers concrete cross-report questions with read-only access and documented limits. Continue only if users prefer it to filters, exports, and custom policies.

**Prototype complete:** the dashboard has an allowlisted SQL-like query over the latest 100 account-scoped report snapshots. It supports filter, sort, projection, and limit operations with no SQL execution or AWS access. Decide whether to retain or expand this interface after using it for real cross-report questions.

## Guardrails

- Keep scans read-only and make requested AWS permissions explicit.
- Represent incomplete evidence explicitly; absence of a finding is not proof of a pass.
- Keep controls versioned and claim only the controls supported by actual evidence.
- Prefer one complete, tested vertical slice over increasing scanner count for its own sake.
- Do not promise multi-cloud support, real-time enforcement, verified exploitability, or production-scale availability without implementing and demonstrating them.
