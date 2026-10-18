# SSL Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add Certbot certificate expiry, Nginx issuance/install and scoped renewal to LabServer.
**Architecture:** Reuse Docker plan's runner and owned broker. Per-session write reservations serialize Certbot with Nginx/file writes; renderer guards dirty editors. Certbot owns remote issuance/config changes; UI never receives private key data.
**Tech Stack:** Existing Electron/SSH/vanilla JS/node:test; Certbot Nginx on target VPS.
**Spec:** docs/superpowers/specs/2026-10-18-docker-ssl-design.md (approved 18 October 2026).

## Global Constraints
- Same branch/dirty-work preservation and no new dependencies as Docker plan. No live user VPS actions during development.
- Let's Encrypt HTTP-01, existing host Nginx only; no wildcard, manual/Origin import, removal/revocation or container Nginx.
- List metadata only; native confirmation, explicit Terms consent, domains/email/redirect visible. Existing same-name domain set cannot be silently reduced/replaced.
- Preflight nginx -t and root detection from nginx -V --conf-path using configured binary; refuse unsafe/unknown root. Postflight nginx -t after Certbot. No forced or automatic mutation retry.
- Certbot renewal only selected --cert-name and only when due, 300s/1MiB. Other reads 20s/1MiB. Cancellation/disconnect is not promised rollback.
- SSL cannot overlap transfer/file mutations/dirty file editors or Nginx writes. While SSL is reserved, new remote writes/transfers/retries are blocked; reads and terminals remain usable.
- Invalidate Nginx syntax state when Certbot starts, including failures. Prompt before disconnect/close during actions. No backup migration/private-key reads; no desktop renewal scheduler.

## Review Focus
- Same certificate name with different SAN set must not silently change existing domain coverage.
- A same-name container or stale SSH result cannot reach the replacement connection; same rule applies to certificates.
- SSL confirmation and sudo delay must not open races with Nginx writes, queued transfers or file save.
- Certbot partial failure, timeout or output cap cannot be presented as rollback/safe-to-retry automatically.
- Certificate parse/date failure must be unknown, never valid; raw Certbot key paths/logs must not leak through renderer API.

### Task 1: SSL catalog, write reservations and IPC
**Files:** Create main/ssl-ops.js, test/ssl-ops.test.js; modify sessions.js, ipc.js, files-ipc.js, server-tools-ipc.js, preload.js; tests server-tools-ipc.test.js/files-locks.test.js and files-ipc.test.js.
**Interfaces:** createSslOps(runner,profile) -> {request(op,input,context)}; sessions.ssl(id,op,input,context), acquireWrite(id)->release, sslBusy(id), busyActions(id). files.blocksSsl(id) reports any active queue/operation/dirty editor. api.ssl.call/cancel. context.canStart(), confirm(action,summary), nginxChanged() notifies tools:event {serverId,type:'nginx-changed'}.
- [x] Write failing tests with literal Certbot output for valid/expired/malformed dates, missing tools, hidden private key fields, invalid domains/email/consent, safe nginx root, collision SAN set, cancel/no commands, renewal skip, preflight/postflight failure, session disposal, locks covering pending confirmation and in-flight file writes.
- [x] Run node --test test/ssl-ops.test.js test/server-tools-ipc.test.js test/files-locks.test.js. Expected FAIL at missing SSL operations/reservations.
- [x] Implement catalog; reserve SSL synchronously before confirmation, reject existing writes/transfer/dirty state, release in finally. Nginx call mutations and file operations acquire write reservations. Extend close/disconnect guards and notify syntax invalidation before a Certbot mutating command starts.
- [x] Run targeted tests. Expected PASS.

### Task 2: SSL UI and full workspace flow
**Files:** Create renderer/ssl.js; modify tools.css, app.js/index.html/renderer.js/icons.js; helpers tools fixture and scripts/smoke-ui.js; README.
**Interfaces:** same owned call/cancel as Docker; onShow('ssl') lists metadata; onLeave cancels reads. Existing guardFileChanges and Nginx nav guards are used before issuance/renewal.
- [x] Write failing UI cases: eight connected tabs, expiry states, installation form validation and consent, native cancel/approve, renewal skip, setup/copy guide, domain collision/preflight errors, old syntax invalidation, SSL-vs-editor/transfer guards, leave/disconnect teardown.
- [x] Run Electron smoke. Expected FAIL at SSL tab/flow.
- [x] Implement certificate table, issuance dialog, renewal action, clear partial-change messages and setup guide with official links. Follow app themes/responsive patterns. Document limitations and live-vs-fixture verification.
- [x] Run UI smoke with screenshots, inspect dark/light/900px. Expected PASS.

### Task 3: Whole-feature verification and release
- [x] Run npm test, lint, build:renderer, UI smoke and diff check. Expected green, with skipped external integration count reported.
- [x] Dispatch one fresh independent read-only reviewer for Docker+SSL implementation and spec Review Focus. Fix Important/Critical findings once using failing regression tests then full green suite; no re-review.
- [x] Build electron-builder --mac dmg --arm64 --publish never after UI tests finish. Verify codesign --deep --strict, hdiutil verify, source parity in app.asar, refresh/check SHA256 sidecar.
- [x] Record evidence/decisions in ledger and both plans; final response includes features, installer, validation and material limits (fixture ACME/daemon, ad-hoc signing).

Completion evidence: 183 tests total / 178 pass / 5 external skips / 0 failures; lint, renderer build and diff check pass. Real Electron UI: 168 checks pass / 2 native fullscreen checks explicitly skipped / no renderer errors. One independent review found three Important/P2 issues; all reproduced and fixed with regression coverage once, no re-review or deferred findings. ARM DMG built; strict deep codesign, hdiutil and SHA256 sidecar verify. All 255 packaged source/assets match tested workspace; runtime package metadata matches after normal builder removal of scripts/devDependencies/build. Signing is ad-hoc, no Developer ID/notarization. Live Docker daemon/ACME and skipped native capabilities remain unverified. See ledger for decisions, costs and SHA256.
