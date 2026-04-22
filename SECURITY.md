# Reporting a Security Vulnerability

Do **not** open a public GitHub issue for security reports.

Email: **security@it-baer.net**  (PGP key on request)

Please include:

- Affected plugin ID + version
- Grafana version(s) where the issue reproduces
- Impact assessment (data exposure, privilege escalation, DoS, etc.)
- Reproduction steps or PoC
- Your contact for follow-up credit (optional)

## Response targets

- Acknowledgement: within 72 hours
- Triage + initial assessment: within 7 days
- Patch release: timing depends on severity (CVSS)
  - Critical / High: emergency release ASAP
  - Medium: within the next minor version cycle
  - Low: rolled into the next planned release

## Disclosure

Coordinated disclosure. After a fix ships, we will publish a GitHub Security
Advisory with CVE (if applicable) and credit the reporter unless they request
otherwise.

## Supported versions

Only the latest minor version of each plugin receives security fixes. Please
upgrade to the current release before reporting.
