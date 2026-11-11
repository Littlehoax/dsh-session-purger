# dsh-session-purger

Permanently delete conversations from the DeepSeek Harness Web sidebar.

The built-in sidebar can archive a conversation, but never remove its local
history. This plugin adds a **Delete conversation** action to every session's
`…` menu, with a confirmation dialog. Confirming removes the session from the
sidebar immediately and deletes its persisted log from disk.

## Features

- **Delete conversation** row in the session `…` menu, using the built-in
  trash glyph so it matches the other menu rows.
- Confirmation dialog rendered in the harness overlay layer (no `window.confirm`).
- Stops a running agent for that session before deletion.
- Removes the live session entry, so the row disappears without a page reload.
- Moves the session directory to a sibling trash folder first, then removes it
  in the background — this survives the open append handle that the JSONL
  persistence backend keeps on Windows.
- Cleans up the pin state best-effort; a deleted session never reappears.

## Requirements

- DeepSeek Harness **desktop**, `0.2.2-rc.1` (the `engines.dsh` range allows
  `>=0.2.2-rc.1 <0.3.0`).
- The Web profile with the built-in JSONL session persistence (the desktop
  default). The plugin relies on the `session.v4.jsonl[.zstd]` directory layout.
- The built-in sidebar / context-menu client plugins, which are part of
  `@deepseek-ai/dsh-web-app`.

## Install

Use the plugin manager in the harness (Settings → Plugins → install bundle), or
ask the harness agent to call `plugin_manager install_bundle` with one of:

| Source | `target` example |
| --- | --- |
| Local checkout | `C:\path\to\dsh-session-purger` (absolute path) |
| Tarball file | `C:\path\to\dsh-session-purger-0.1.0.tgz` |
| Tarball URL | `https://example.com/dsh-session-purger-0.1.0.tgz` |
| Git repository | `github:Littlehoax/dsh-session-purger` |
| npm registry | `dsh-session-purger@0.1.0` |

A local directory install is a `link:` dependency: keep the directory where it
is. A tarball or registry install is copied into the profile.

After installation the host half is hot-reloaded; the client half appears in the
page immediately. If the menu entry is missing, reload the page once.

## Usage

1. Open the `…` menu of any conversation in the sidebar.
2. Click **Delete conversation**.
3. Confirm. The row disappears and the log directory is removed.

Deletion is permanent — there is no undo and no trash UI.

## How it works

- Host half: `index.js` provides a `sessionDelete` service (`ctx.provide`) with a
  manually attached Typert remote marker, so the client can call
  `sessionDelete/delete` over the gateway without any `@deepseek-ai/*` imports
  (the installed plugin must run from the profile, which has no framework
  packages).
- The service validates the id, reads `sessionPersistence.stat(sessionId)`,
  refuses sessions whose writer is mid-append, cancels the agent, detaches the
  live session entry and emits `api-session/removed`.
- The session directory is derived from `stat.location.path` when the log is
  materialized, otherwise from the header cwd, with a scan over the session root
  as fallback.
- The directory is renamed into `dirname(sessionRoot)/.dsh-session-trash/` and
  removed asynchronously with retries; the trash folder lives outside the session
  root so the persistence lister never sees it.
- Client half: `client.js` loads as a Web client module, registers the
  `session.delete` context-menu contribution (target `session`, order 700), and
  renders the confirmation dialog through the `shell.overlay` slot.

The icon reuses the built-in `workspace.delete` glyph key, so it matches the
other sidebar menu icons without shipping an icon font.

## Compatibility and caveats

- Uses internal seams (`sessionPersistence.stat().location`, the session store's
  `detach()`, `api-session/removed`, the source-mode Typert remote marker,
  `contextMenus`, `shell.overlay`). A future harness release may move these;
  `engines.dsh` makes an incompatible install fail loudly instead of half
  working.
- Only the JSONL persistence layout is supported. A different persistence
  backend or a different on-disk naming scheme makes deletion report
  `session-delete/io-failed`.
- The directory rename trick assumes the session root is writable.
- Session search indexes are query-time; the next list refresh no longer
  includes the deleted id.

## Development

```bash
# syntax check the host and client bundles
node --check index.js
cp client.js client.mjs && node --check client.mjs && rm client.mjs

# build the distributable tarball
pnpm pack
```

Layout:

```
index.js           host service (no external imports)
client.js          Web client module (window.__ModuleLoader__)
cordis.patch.yml   bundle patch row
locale/en.json     English metadata
locale/zh.json     Chinese metadata
icon.svg           package icon
```

## License

MIT