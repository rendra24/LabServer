# File Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved two-panel SFTP file manager to the active LabServer SSH session.

**Architecture:** Main-process services own local directory grants, remote SFTP operations, and streamed transfer queues. Narrow guarded IPC connects those services to two file panels and the bundled Ace editor; the existing SSH transport, terminal, monitoring, and Nginx remain shared. Transfers are bound to a connection instance and webContents, and publish throttled metadata events only.

**Tech Stack:** Existing Electron 44, Node filesystem/streams/crypto, ssh2 1.17, plain renderer modules, Ace, local CSS.

**Spec:** `docs/superpowers/specs/2026-10-17-file-manager-design.md`

## Global Constraints

- SFTP on the active SSH connection; no FTP login, new backend, sudo, or chmod/chown UI.
- Two panels: local left, VPS right. Native local-folder grants; remote starts at SSH home.
- Two concurrent transfer jobs; recursive files/folders; streaming; no byte-offset resume or persistent queue.
- Explicit skip/rename/overwrite conflicts; old destination survives incomplete transfer; no delete-first replacement.
- Editor UTF-8 at most 1 MiB; binary rejected; protect external changes and unsaved buffers.
- No recursive symlink following, no out-of-grant local access, no unsafe remote-to-local filenames.
- Preserve user data, credential namespace, backups, monitoring as connection landing page, themes, sidebar controls.

## Review Focus

- Local root/path swapped to a symlink after selection: containment is checked again at every operation/commit; no outside writes (Task 1/3).
- Destination appears or changes while a transfer is running: commit detects it and requests a fresh decision (Task 3).
- Late progress/error after reconnect: connection UUID and server ID filter stale events (Task 4/5).
- Replacing an existing owned file on a server lacking atomic replace: fail with old file intact (Task 2/3).
- File-manager writes to configured Nginx directories: invalidate previous syntax validation (Task 4/5).

## Files and Interfaces

- `desktop/src/main/file-utils.js`: typed errors, remote paths, safe names, SFTP promise wrapper, metadata, revisions.
- `desktop/src/main/local-files.js`: `createLocalFiles()` → `{grant(path), list(grantId, relative), resolve(grantId, relative), roots(), clear()}`; root capabilities are opaque UUIDs and resolve real filesystem paths in main.
- `desktop/src/main/remote-files.js`: `createRemoteFiles(conn)` → `{home(), list(path), stat(path), read(path), save(path,text,revision,force), mkdir(path,name), rename(path,name), remove(paths), readStream(path), writeStream(path), commit(tmp,dest,expected), cleanup(path)}`.
- `desktop/src/main/file-transfers.js`: `createTransfers({remote,local,emit,changed})` → `{start(direction,sources,destination), list(), cancel(id), retry(id), decide(id,choice,all), active(), dispose()}`. Transfer metadata contains no contents/credentials.
- `desktop/src/main/files-ipc.js`: `registerFilesIpc({handle,dialog,winOf,sessions,store})` installs `files:call`, `files:local`, `files:pick`, `files:drop` and returns lifecycle helpers. Per-sender workspace includes a connection UUID, services, and editor dirty state. Grants are per webContents.
- Modify `sessions.js` to expose internal `connection(id)` without exposing SSH objects through preload.
- Preload `api.files.{call,local,pick,drop,onEvent}`; drop resolves genuine `File` objects with Electron `webUtils.getPathForFile`, never renderer-supplied path grants.
- `desktop/src/renderer/files.js` two-panel workspace; `files-editor.js` Ace editor and dirty guards; `files.css` isolated styles.
- Modify renderer app navigation, index HTML, entry imports, icons, vendor Ace modes, and close/disconnect guards.
- Tests: `file-access.test.js`, `remote-files.test.js`, `file-transfers.test.js`, SFTP fixture helper, UI smoke extension, README.

### Task 1: Validated local and remote filesystem access

- [x] Write `file-access.test.js`: native-granted root can list children; unknown grant, `..`, symlink escape, malformed name, Windows reserved/traversal names are rejected; hidden and Unicode names are preserved.
- [x] Run `node --test test/file-access.test.js`, observe missing-module failure.
- [x] Implement utilities and `createLocalFiles()` with realpath containment and bounded, typed metadata; no raw filesystem access in renderer.
- [x] Rerun access tests; confirm pass.

### Task 2: SFTP file operations and editor persistence

- [x] Write `remote-files.test.js` with filesystem-backed SFTP fixture: home/list, mkdir/rename/delete, symlink unlink rather than traversal, root protection, UTF-8/binary/1 MiB boundary, revision conflict, temp cleanup, atomic-rename unsupported leaves old bytes intact.
- [x] Observe failing module import, then implement `createRemoteFiles(conn)` with literal SFTP operations and safe commits; preserve file permissions/ownership or fail.
- [x] Run both access and remote tests and confirm pass.

### Task 3: Recursive streaming transfer queue

- [x] Write `file-transfers.test.js`: upload/download nested directories including empty and hidden files, bytes equal; explicit name conflict decision; cancel/retry; existing file survives failed stream; no symlink escape; two-job concurrency; stale/disposed jobs cannot commit.
- [x] Observe missing-module failure, implement queue with per-job abort signals, throttled events, temp files, revision checks and per-item summaries.
- [x] Run relevant tests and confirm pass. Do not close shared SFTP on cancellation.

### Task 4: Main-process broker and lifecycle integration

- [x] Add guarded IPC with per-window folder grants, verified drop sources, active-session workspaces, and connection IDs. Expose only narrow preload methods.
- [x] Add dirty-editor/active-transfer guards to disconnect and application close; preserve jobs across view changes and clear resources on actual disconnect.
- [x] Emit file mutations to invalidate Nginx syntax validity; test guard cancellation, late events, and wrong-owner/invalid requests.

### Task 5: Two-panel renderer and text editor

- [x] Build local/remote panels, native pickers, multi-selection, filter/sort/hidden controls, folder navigation, detail overlay, CRUD dialogs, conflict dialog, transfer queue and buttons.
- [x] Integrate Ace editor, revision conflicts, save/discard/cancel prompt, Cmd/Ctrl+S, themes, view persistence and close guards.
- [x] Extend Electron smoke with filesystem and SSH fixtures; prove two panels, real file bytes, recursion, cancel/conflicts, dirty editing, theme/sidebar and minimum width; fix defects found.

### Task 6: Verification and delivery

- [x] Update README with use, scope, permissions, cancellation behavior and retry limits.
- [x] Run lint, renderer build, `npm test`, targeted UI smoke; inspect screenshots. Only environment-dependent integrations may skip, with explicit reporting.
- [x] Fresh-context whole-change review; fix important findings with regression tests, then rerun affected checks.
- [x] Build macOS arm64/x64 and Windows installers and verify packaged source/assets match. Deliver links and material limitations.

## Execution ledger

Execution is inline in the existing workspace because all prior authorized changes are uncommitted here. Do not reset/stash user work or create commits containing unrelated edits. Record task outcomes and any design rulings in `2026-10-17-file-manager-ledger.md`.
