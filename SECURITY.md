# Responsible reporting

Never attach API keys, passwords, original business exports, personal records,
.env files or production logs to public issues or pull requests.

For a non-sensitive bug, open an issue with a minimal synthetic reproducer and
expected/actual behavior. If a security issue involves secrets or customer data,
use GitHub's private vulnerability reporting when it is available. If it is not
enabled, ask the maintainer for a private reporting channel without disclosing
exploit details or sensitive information in a public issue.

Local mode binds to loopback. Use the authenticated WSGI entry point behind HTTPS
for controlled deployments, following docs/DEPLOYMENT.md. Uploaded business
files do not belong in this repository. Optional model calls require explicit
UI consent and disclose aggregate evidence only; review the selected endpoint
and business authorization before enabling them.
