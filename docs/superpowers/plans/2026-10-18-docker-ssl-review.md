# Docker/SSL whole-feature review package

Review the current worktree on codex/docker-ssl-manager. Previous accepted features are extensively uncommitted/untracked; HEAD diff alone is NOT the feature range. Do not reset/stage/commit anything. Focus on the following new feature files and their integrations.

Spec: docs/superpowers/specs/2026-10-18-docker-ssl-design.md (user approved)
Plans: docs/superpowers/plans/2026-10-18-docker-manager.md and 2026-10-18-ssl-manager.md
Ledger/rulings: docs/superpowers/plans/2026-10-18-docker-ssl-ledger.md

## New implementation
- desktop/src/main/tool-runner.js: bounded SSH execution, safe errors, shared in-memory sudo cache/lifetime.
- desktop/src/main/docker-ops.js: explicit local daemon, validated catalog, list/stats/detail/actions/log.
- desktop/src/main/ssl-ops.js: Certbot metadata/issue/renew, Nginx pre/postflight, root detection, SAN preservation, partial-change messages.
- desktop/src/main/server-tools-ipc.js: trusted-wrapper callbacks, request ownership/cancel/native confirm, syntax notifications.
- desktop/src/renderer/docker.js, ssl.js, tools.css: contextual UI, state/timers/actions/dialogs, dirty file guard and syntax invalidation.

## Existing-file integrations to inspect
- sessions.js: runner lifetime, docker/ssl calls, sslPending + writes reservation, busyActions; Nginx call writes and nginx systemd actions reserve against SSL.
- ipc.js: registerServerToolsIpc, files guard injection, cancel/preserve native disconnect/window close during actions, capture connection before await disconnect confirmation.
- files-ipc.js: remote write/transfer/retry blocked while SSL; acquireWrite covers file operation lifetime; blocksSsl checks active queue/operations/dirty editor across owners.
- terminal.js main/renderer: validated container exec PTY, shell whitelist/sudo PTY, container metadata in xterm tabs and open/reopen/onShow. Existing input/ack code retained.
- preload.js: narrow Docker/SSL and tools:event APIs.
- app.js/renderer.js/index.html/icons.js: 8 contextual tabs, dirty Nginx navigation guards, horizontal active-tab visibility after resize.
- README/spec/plans/screenshots: current feature description/limits.

## Evidence
- Main tests: docker-ops.test.js, ssl-ops.test.js, server-tools-ipc.test.js, files-locks.test.js; terminal.test.js container PTY; actual files-ipc.test.js validates trusted frames and native close/disconnect while Docker or SSL confirmation is pending over real SSH.
- Full suite last pass: 175 total, 170 pass, 5 external Docker/OpenSSH/Prometheus integrations skipped. Fresh final rerun passed after scoped Nginx service lock integration.
- Real Electron UI via local SSH fixture covers current/new features, no live VPS or ACME. Final expanded run 167 passed with 2 native checks skipped, including host/container coexistence and missing container shell. No renderer errors.
- Explicit LABSERVER_UI_DOM_FULLSCREEN=1 is used because a standalone Electron probe could not focus and emitted only enter-html-full-screen, never native enter-full-screen. Default native checks remain; DOM fullscreen/layout/buttons/tab/navigation tested. Native macOS window transition and native Escape reported skipped. Fixture now waits fullscreenchange and rendered layout instead of sampling stale frame state.
- All user-owned data/profile/keychain namespaces preserved, no new backup schema.

## Review Focus (verbatim from plans)
- Changed/removed container ID after selection must never target a namesake or leak inspect environment.
- Container PTY early output/exit and sudo prompts must stay within the correct xterm tab; closed/disposed sessions cannot attach later channels.
- Cancellation/queued sudo after reconnect must not act on a new session.
- Busy-action guards must preserve the active connection when close/disconnect is cancelled.
- Malformed/oversized daemon output and inherited remote DOCKER_CONTEXT must not silently target another host.
- Same certificate name with different SAN set must not silently change existing domain coverage.
- A same-name container or stale SSH result cannot reach the replacement connection; same rule applies to certificates.
- SSL confirmation and sudo delay must not open races with Nginx writes, queued transfers or file save.
- Certbot partial failure, timeout or output cap cannot be presented as rollback/safe-to-retry automatically.
- Certificate parse/date failure must be unknown, never valid; raw Certbot key paths/logs must not leak through renderer API.

Judge reasonable user expectations beyond literal spec. One potential issue worth checking: list refresh vs issuance UI generations while a prior list request is pending. Report only actionable material issues, not generic refactors. Include file:line, effect, severity, suggested regression, and Declined to judge list with reasons. Read-only, no subagents, no live VPS commands.

## Independent final review result

Fresh read-only reviewer completed the original scope: three Important/P2 findings, no Critical findings. No re-review requested or performed.

1. Stale SSL list success/error could overwrite completed issue/renew data. Reproduced with four deferred-response renderer regressions (RED), then invalidate generation and cancel list reads when mutation starts (GREEN).
2. Nginx `--conf-path=/etc/nginx/custom.conf` passed root discovery although Certbot opens `nginx.conf` within the root. Reproduced issuance reaching the wrong filename (RED); require basename `nginx.conf` before mutating commands/syntax invalidation (GREEN). User error and README describe the supported configuration. Confirmed against [official Certbot parser](https://raw.githubusercontent.com/certbot/certbot/main/certbot/src/certbot/_internal/plugins/nginx/parser.py).
3. Certbot `INVALID: TEST_CERT` with a future expiry appeared green. Reproduced using actual parser and renderer state (RED); preserve enum validity/testCertificate booleans and show invalid/staging warning with retained expiry (GREEN). Valid, test and invalid-expired fixtures covered; real Electron smoke includes a staging row. Official example: [Certbot guide](https://github.com/certbot/certbot/blob/main/certbot/docs/using.rst).

Reviewer strengths: narrow command validation/quoting, explicit Docker socket/IDs, pinned connection lifetime, SSL write reservations, no private key bodies in renderer, partial-change semantics and container terminal correlation.

Declined to judge: live Docker/ACME and distribution compatibility (no authorized live VPS testing); native macOS fullscreen/Escape (host capability skipped); installer integrity/signing (packaged after review); unrelated accepted feature foundation and fixes made after the original review. Reviewer used focused read-only reproductions; full-suite/UI evidence is maintained by implementer.
