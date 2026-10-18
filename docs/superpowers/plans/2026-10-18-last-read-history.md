# Last-read snapshots

User requested persistent last-read history so Service Manager, Docker Manager, SSL Manager and Nginx configuration pages display previous results immediately, then refresh in the background. Continue using established recommendation/autonomy preference; implement within existing Electron/SSH architecture without new dependencies.

- Cache only the latest successful list snapshot per server/feature, with retrieval timestamp; never log bodies, editor buffers/configuration contents, private keys, passwords or validity of prior nginx -t checks.
- Main process owns cache writes from real successful reads, renderer can only read. Scope by server UUID, endpoint, account/auth/key path, Nginx settings and trusted host fingerprint pinned to SSH connection. Editing target or changing trust cannot reuse another server's history. Deletion/forget-host-key removes snapshots.
- Atomic private local files, bounded snapshots/storage. Corruption/full disk/read-only storage is a cache miss and cannot fail a live operation. Cache is disposable derived data and is not included in portable profile/credential backups.
- Display “Data terakhir” with time and background-refresh indication, retain rows on refresh failure and show failure. No cache exists: ordinary loading. Successful empty list replaces older nonempty history. Side effects wait for a fresh list; main still validates targets independently.
- Invalidate relevant snapshots before mutations (including partial/timeout changes) and reject in-flight old reads after writes/reconnect. Nginx/SSL share invalidation; no old syntax result may authorize reload.
- Preserve earlier dirty work on codex/last-read-history without mixing it into commits. No live VPS actions.

## Work
- [x] RED→GREEN durable bounded cache isolation/validation/empty results/corruption/IO/stale sequencing.
- [x] Session/main IPC recording and mutation invalidation; narrow preload read API and real integration tests.
- [x] Cached-first renderer flow on all four pages, time label and fresh-action guards; regression tests across failures/navigation/server changes.
- [ ] Full backend/lint/build/UI tests, independent scoped review and fixes; dark/light/900px inspection.
- [ ] ARM installer build, strict signing/integrity/source parity/SHA256 verification and completion evidence.
