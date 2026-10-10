# Zeus Local Agent

This is the optional local component for Phase 6. The web app cannot access the computer's filesystem or launch local apps on its own; this agent exposes a small, explicit, permission-scoped API on loopback.

## Requirements

- Node.js 20 or newer.
- A directory you explicitly want to authorize.
- The Zeus web app at `https://zeus.morok.korczaktech.com.br`.

## Start on Linux

From this folder, configure only the directories Zeus may see, then start the agent:

```bash
export ZEUS_AGENT_ALLOWED_DIRS="$HOME/Documents:$HOME/Projects"
node agent.js
```

Use paths that exist on your computer. On Windows, use semicolons between paths; on macOS/Linux, use colons. If `ZEUS_AGENT_ALLOWED_DIRS` is empty, the agent exposes no filesystem roots.

On first launch, the agent creates `~/.zeus-agent/token` with restrictive permissions and prints a pairing token once. Paste that token into **Zeus → Configurações → Agente local** in the same browser session. Never share it or commit it to Git.

The service binds only to `127.0.0.1`, checks the browser origin, validates the bearer token, blocks directory traversal and symlink escapes, and limits request rates. It does not expose a public network port.

## Supported endpoints

- `GET /health` — minimal health check.
- `GET /v1/system/info` — operating system and agent capabilities.
- `GET /v1/files/roots` — explicitly authorized folders.
- `GET /v1/files/list?root=0&path=` — list a folder.
- `GET /v1/files/read?root=0&path=relative/file.txt` — read a text file up to 1 MB.
- `POST /v1/files/write` — disabled unless `ZEUS_AGENT_ALLOW_WRITE=true`; requires `confirm: true`, an allowed root and a text file. Existing files are backed up under `~/.zeus-agent/backups`.
- `POST /v1/apps/launch` — disabled unless the app ID exists in the administrator-configured `ZEUS_AGENT_ALLOWED_APPS` JSON allowlist. It never accepts arbitrary command strings from the browser.

## Important boundaries

- Only paths under `ZEUS_AGENT_ALLOWED_DIRS` are accessible.
- Text file reading is enabled; PDFs, Office files and arbitrary binary files need dedicated parsers before support is added.
- File writes and app launching are off by default.
- The agent does not execute arbitrary shell commands, collect telemetry, or expose credentials.
- Browser access to loopback may trigger a browser local-network permission prompt. Approve it only for the trusted Zeus site.
- This component has passed source-level checks, but must be tested on each supported operating system before being called production-ready.
