# Cloudflare DNS Management Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans, with tests before implementation. Preserve existing uncommitted changes.

**Goal:** Add global DNS Management with memo + encrypted API Token, domain selection and DNS CRUD, plus token instructions.
**Architecture:** Fixed-origin Cloudflare REST calls in Electron main behind narrow, trusted-frame IPC. Existing store handles encrypted credentials and atomic backup/restore; renderer never receives stored tokens. Independent global DNS view preserves connected SSH workspace across navigation.
**Tech Stack:** Existing vanilla ES modules, Node fetch, Electron safeStorage, node:test, Electron UI smoke; no dependencies.
**Spec:** User request and approved clarification: memo/label + API Token, global sidebar peer of Server, domains and DNS CRUD.

## Global Constraints
- Preserve existing data directory and app identity.
- Native confirmation before deleting DNS or local Cloudflare accounts; no automatic retries of mutations.
- Keep dark/light themes and minimum 900px desktop width.
- API token guidance: Zone / Zone / Read and Zone / DNS / Edit, selected zone resources, profile API Tokens link.
- Support creating/editing A, AAAA, CNAME, TXT, MX, NS, SRV, CAA; list other types and identify unsupported editing.

## Review Focus
- Token errors and response messages must never disclose credentials to renderer or logs.
- Switching domains/accounts during a request must not display or mutate the wrong selection.
- Global navigation must preserve SSH sessions and guard unsaved editor changes.
- Invalid names, content, TTL, proxy and structured data must be rejected before mutation.
- Backup of DNS-only profiles and old backups must restore safely without losing local accounts.

### Task 1: Main API and secure account persistence
Files: desktop/src/main/cloudflare.js, dns-ipc.js, store.js, ipc.js; desktop/test/cloudflare.test.js, dns-ipc.test.js.
Interfaces: createCloudflareClient(token, fetchImpl).zones(), records(zoneId, options), zone(zoneId), record(zoneId,id), create/update/remove; store listCloudflare/saveCloudflare/getCloudflareToken/removeCloudflare/exportCloudflare.
- [x] Write failing tests for encrypted persistence, pagination/auth/error handling, record validation, confirmation and stale updates.
- [x] Run new tests RED, implement fixed-origin API + account storage and trusted IPC registration, run GREEN.

### Task 2: Global DNS interface
Files: desktop/src/preload/preload.js; renderer dns.js, dns.css, index.html, icons.js, app.js, renderer.js; scripts/smoke-ui.js.
Interfaces: api.dns.accounts/save/removeAccount/zones/records/create/update/remove; existing onShow/show and editor guards.
- [x] Add failing UI flow for initial setup, guidance, account connect, domain selection, CRUD, failure states, themes and server session preservation.
- [x] Implement form, domain selector, search/pagination/table, record dialogs and responsive styles; run UI GREEN.

### Task 3: Backup, docs and final validation
Files: store.js, backup.js, backup-ipc.js, renderer backup.js/index.html; backup tests, README.md, docs/backup-format.md.
Interfaces: optional cloudflare array in encrypted v1 payload; old payloads remain valid; restore journal covers all three local files.
- [x] Test DNS-only and old backups, conflict handling, decryption failure and atomic rollback.
- [x] Implement backward-compatible optional accounts and summary, update docs, run npm test, lint, build:renderer and test:ui.
- [x] Review final change independently, fix material findings with regression tests, build/verify Apple Silicon DMG and refresh SHA256.

No live Cloudflare mutations during development; remote boundary fixtures use the real client and IPC. Keep the existing dirty checkout and do not package unrelated files into a new commit.

## Execution evidence
- API/store/IPC tests were written first and failed on missing feature interfaces; all added API, validation, persistence and backup tests now pass.
- Independent reviewer `dns_review` found one material race: search invalidated pending zones. Reproduced by UI test RED, fixed using loading guard/search disable, UI GREEN.
- Background SSH loss regression was observed RED and fixed by preserving the active DNS view and draft/focus.
- `npm test`: 133 passed, 5 external integration tests skipped, 0 failed (138 total).
- `npm run lint`, `npm run build:renderer`, `git diff --check`: passed.
- Electron smoke: 113 checks passed, no renderer errors; real client + guarded DNS IPC with remote API fixtures, no user credentials/live DNS changes.
- Screenshots reviewed for dark/light themes, 900px width, guide and Cloudflare backup count.
- No deferred review findings. Existing uncommitted workspace preserved; no new git commit created.
- Apple Silicon DMG built; packaged source comparison, strict deep codesign verification, DMG checksum verification passed; SHA256 sidecar refreshed. Ad-hoc signed, not notarized.
