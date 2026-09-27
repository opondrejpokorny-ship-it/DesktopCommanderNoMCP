# AGENTS.md

## Important: MY37 / Owned Remote composition

If this repository was provided together with:

`opondrejpokorny-ship-it/desktop-commander-owned-remote`

and the user asks to install, reinstall, verify, or troubleshoot the combined Windows Remote MCP setup, treat the task as **MY37**.

Do **not** use the stock/upstream installation instructions in this repository's README for that task.

### Canonical authority

Open the paired Owned Remote repository and read, in this order:

1. `docs/my37-verified-install.json`
2. `docs/MY37_CLEAN_INSTALL_RUNBOOK.md`
3. `docs/AI_INSTALL_MY37.md`

The machine-readable manifest in Owned Remote is the authority for the verified DesktopCommanderNoMCP executable SHA. Do not assume this repository's current `main` is the verified executable release.

### Do not substitute stock installation

For MY37, do not install:

- `@wonderwhy-er/desktop-commander@latest`
- stock Remote MCP from `mcp.desktopcommander.app`
- another Desktop Commander checkout

as a substitute for the exact DesktopCommanderNoMCP pin specified by the Owned Remote manifest.

The README below retains upstream-compatible product documentation because this fork preserves Desktop Commander behavior. Those generic install instructions are **not** the MY37 installation path.

### Installer ownership

The MY37 installer lives in the paired Owned Remote repository:

`scripts/install-my37.ps1`

Use its exact verified pins and acceptance procedure. For unattended/explicitly AI-driven installation, the Owned Remote installer supports `-Yes`; do not remove its normal interactive confirmation default.

### Security

Never expose the ngrok authtoken, capability value, or capability-bearing MCP URL in chat, GitHub, Drive, screenshots, PR text, or shared logs.

Do not weaken existing Desktop Commander handlers or guardrails. MY37 is not a complete security sandbox.
