# Docker Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add Docker container status/resources/actions/logs and container terminals to the connected server workspace.
**Architecture:** Per-session Docker operations use a narrow validated command catalog over bounded remoteCommand. A shared runner owns lifetime/sudo; trusted IPC owns confirmation/cancellation. Existing xterm tabs also accept validated container PTY requests.
**Tech Stack:** Electron, ssh2, xterm, vanilla JS, node:test; no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-18-docker-ssl-design.md (approved 18 October 2026).

## Global Constraints
- Existing dirty checkout contains the accepted app foundation. Preserve all previous work; feature branch codex/docker-ssl-manager, no commits combining previous changes.
- SSH active only; contextual tabs, monitoring landing, dark/light, width 900px, max 8 host/container terminal tabs.
- Docker Engine standard local socket /var/run/docker.sock only; clear inherited context/host variables and pass explicit --host.
- 64 hex container IDs, whitelist start/stop/restart and /bin/sh or /bin/bash. No inspect environment/private metadata, create/delete/Compose/image/volume operations.
- List/detail/stats 1 MiB/20s, logs 512 KiB/15s, actions 90s; no automatic mutation retry. Password stdin only, cached in session memory; container sudo password entered inside PTY.
- Optional list refresh 5s and log refresh 3s, scheduled after completion and stopped on leave/error. Native mutation confirmation.

## Review Focus
- Changed/removed container ID after selection must never target a namesake or leak inspect environment.
- Container PTY early output/exit and sudo prompts must stay within the correct xterm tab; closed/disposed sessions cannot attach later channels.
- Cancellation/queued sudo after reconnect must not act on a new session.
- Busy-action guards must preserve the active connection when close/disconnect is cancelled.
- Malformed/oversized daemon output and inherited remote DOCKER_CONTEXT must not silently target another host.

### Task 1: Docker catalog and session/IPC integration
**Files:** Create desktop/src/main/tool-runner.js, docker-ops.js, server-tools-ipc.js; modify sessions.js, ipc.js, preload/preload.js; test docker-ops.test.js, server-tools-ipc.test.js.
**Interfaces:** createToolRunner(conn,profile) -> {run(command,context,options), privileged(command,context,options), dispose()}; createDockerOps(runner) -> {request(op,input,context), active()}. sessions.docker(id,op,input,context) -> {ok,data}|{ok:false,code,message}. api.docker.call(id,op,input), cancel(id,requestId). context includes signal, confirm(action,identity), askSudoPassword(signal).
- [x] Write failing tests: list with running/exited states and resource mapping, inspect state without env, malicious ID/action rejection without commands, confirmation cancel/approve, per-ID lock, sudo stdin, missing daemon/tools, stale dispose and bounded log truncation. Use literal external command responses, real runner/channels; real SSH in integration.
- [x] Run node --test test/docker-ops.test.js test/server-tools-ipc.test.js. Expected FAIL for missing feature.
- [x] Implement catalog, runner and owned IPC using fixed env and explicit local Docker endpoint; pin each request to connection, sender and AbortSignal. Add sessions.busyActions(id), used for close/disconnect confirmation.
- [x] Run targeted tests. Expected PASS. Preserve previous changes without mixing them into commits.

### Task 2: Docker UI and container PTY
**Files:** Create renderer/docker.js, tools.css; modify renderer index.html/app.js/renderer.js/icons.js/terminal.js; main terminal.js; helpers/sshServer.js and docker fixture; terminal.test.js, terminal-ssh.test.js, scripts/smoke-ui.js.
**Interfaces:** api.terminal.open(id,{cols,rows,requestId,containerId?,shell?,sudo?}); onShow('terminal',{container:{id,name,shell,sudo}}) opens one container tab. Renderer docker call inputs include UUID requestId.
- [x] Write failing terminal tests for malicious ID/shell rejection, exec with PTY over fixed Docker endpoint, resize/input/close, early events and missing shell. UI tests require 7 server tabs until SSL arrives, resource/search/actions/log/modal teardown and container terminal preserving host shell.
- [x] Run terminal tests and UI smoke. Expected FAIL at new behavior.
- [x] Implement contextual table, selection controls, optional refresh, bounded log dialog, setup guide and container terminal launch. Reuse existing input/ack and tab lifecycle.
- [x] Run terminal tests and real Electron smoke; inspect dark/light/900px screenshots. Expected PASS.

### Task 3: Docker checkpoint
- [x] Run npm test, npm run lint, npm run build:renderer and git diff --check. Expected no failures; environment-dependent integrations may remain skipped and must be reported.
- [x] Update this plan/ledger with evidence and continue to SSL plan without another approval step. Final independent review and ARM packaging cover both plans after SSL integration.

Combined completion: Docker and SSL tasks finished on codex/docker-ssl-manager with earlier accepted work preserved. Final post-review verification: 178/183 backend tests pass (5 external skips), 168 Electron UI checks pass (2 native checks skipped), lint/build/diff checks pass. ARM DMG strict signature/integrity/SHA256 and all 255 packaged source/assets verified. One independent reviewer found three SSL P2 issues, fixed once with regressions; no Critical/deferred findings or re-review. Release is ad-hoc signed and fixture-tested; see SSL plan and shared ledger for complete evidence/limits.
