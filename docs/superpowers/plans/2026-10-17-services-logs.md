# Service Manager and Log Viewer Implementation Plan

> Execute inline with superpowers:executing-plans and test-first verification. Preserve the shared dirty checkout and all existing features.

**Goal:** Deliver the two user-approved recommendations: systemd service status/start/stop/restart and searchable, error-filtered service/Nginx/application logs inside the connected server workspace.
**Architecture:** Reuse the existing SSH session, trusted-frame IPC and sudo prompt. New bounded SSH command execution closes channels on timeout, cancellation or output limits. Main owns a narrow command catalog, validates every argument, confirms service mutations natively and scopes requests to sender/session. Renderer uses server-context tabs and cancels reads/auto-refresh on navigation.
**Tech stack:** Existing Electron, ssh2, vanilla ES modules and node:test; no new dependencies.
**Spec:** User accepted Service Manager + Log Viewer recommendation; scope clarified in commentary in this chat.

## Global constraints
- No connection-independent sidebar entries for per-VPS features; preserve monitoring as connect landing page.
- Service actions: start/stop/restart only, native confirmation, safe .service unit names, serialized mutations per unit. No package installation or service deletion.
- Systemd listing/details use fixed commands; sudo on mutations when needed. Credentials stay in memory for the SSH session.
- Log sources: systemd journal, /var/log/nginx/access.log, /var/log/nginx/error.log, explicit absolute application file. Only regular files, no shell interpolation.
- Logs: last 100/300/500/1000 lines, 512 KiB output cap, optional sudo, search within displayed lines, error filtering, opt-in auto-refresh every 3 seconds. Errors stop auto-refresh.
- Service listing/details max 1 MiB, 20s; actions 60s; log reads 15s. Closing a channel does not imply a remote service job was undone; do not retry mutations automatically.
- Dark/light themes, minimum desktop width 900px, accessible tables/forms and native confirmations.

## Review focus
- Shell injection/option injection through unit names or log paths; unsupported .target/template actions.
- Requests/password prompts arriving after disconnect/reconnect must not act on a replacement session or leak credentials.
- Output flood, stderr flood, missing tools, permission failures, hung channels and cancellation must remain bounded.
- Refresh/navigation must not display another server/source's results or keep background polling alive.
- Service/log navigation must preserve terminal tabs, DNS independence and unsaved Nginx/file editor guards.

### Task 1: Main operations and SSH limits
Files: desktop/src/main/system-ops.js, remote-command.js, sessions.js; desktop/test/system-ops.test.js, remote-command.test.js; test helpers.
Interfaces: createSystemOps(conn, profile).request(op,input,context) and dispose(); remoteCommand(conn,command,{stdin,signal,maxBytes,timeoutMs}) -> {code,stdout,stderr,truncated}.
- [x] Write and run failing tests for parsing, validation, confirmation, sudo, bounds, cancellation and unsupported/permission failures.
- [x] Implement bounded channel handling and service/log catalog, integrate per-session lifecycle, run targeted tests.

### Task 2: Trusted IPC and interface
Files: desktop/src/main/system-ipc.js, ipc.js; preload/preload.js; renderer system.js, system.css, app.js, renderer.js, icons.js, index.html; scripts/smoke-ui.js.
Interfaces: api.system.call(serverId,op,input), cancel(serverId,requestId); operations services/detail/action/logs. Context carries captured sender confirmation, sudo, cancellation.
- [x] Write failing IPC/UI cases covering confirmation cancel/approve, sender-owned cancellation, search/filter, deep link to logs, timers and navigation guards.
- [x] Implement contextual Service Manager + Log Viewer views; horizontal tabs scroll within the workspace when needed.
- [x] Verify real Electron/preload/SSH fixture flow and screenshots in dark/light/900px layouts.

### Task 3: Completion and release
Files: desktop/README.md, screenshots, this plan.
- [x] Run complete npm test, lint, build:renderer, UI smoke and diff check.
- [x] Independent review; fix material findings with RED/GREEN regression tests.
- [x] Build Apple Silicon DMG, compare packaged sources, verify strict deep signature and DMG checksum, refresh SHA256 sidecar.

No live user VPS changes during development; tests simulate systemctl/journal output behind real SSH. No commits combining previous user changes.

## Execution evidence

- Main and IPC regression tests cover service parsing, fixed-command validation, native action cancellation/approval, literal shell quoting, sudo stdin/cache/dispose, sender/session ownership, timeout, cancellation and combined stdout/stderr bounds.
- Independent read-only review found overlapping password dialogs. A real Electron regression reproduced the active dialog being overwritten (RED). The shared SSH/sudo dialog now serializes requests with per-request AbortSignal cancellation, clears its input, and waits for its own close event before opening the next request.
- Electron regression coverage now exercises queued cancellation, active cancellation, distinct passwords per request, service status/actions/details/log deep links, journal/file filtering, missing files, auto-refresh teardown, in-flight SSH channel closure and unsupported servers.
- Dark/light and 900px screenshots inspected; server navigation scrolls within its own header. Existing DNS, terminal, files, backup and unsaved editor flows remain covered.
- Final verification: `npm test` — 153 tests, 148 passed, 5 external integrations skipped, 0 failures. `npm run lint`, `npm run build:renderer` and `git diff --check` passed. Real Electron UI smoke — 140 checks passed, no renderer errors, no live VPS access. External Docker/OpenSSH/Prometheus integrations were not configured.
- Apple Silicon release built with `electron-builder --mac dmg --arm64 --publish never`. All 13 packaged feature source files match the tested workspace. `codesign --verify --deep --strict` passed; `hdiutil verify` reports VALID. SHA256 sidecar refreshed and checked successfully. Output: `desktop/dist/LabServer-0.1.0-arm64.dmg`. Signature remains ad-hoc; Developer ID/notarization is not configured. Intel and Windows installers were not rebuilt in this feature slice.
