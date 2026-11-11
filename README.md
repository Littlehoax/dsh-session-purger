# dsh-session-purger

Permanently delete conversations from the DeepSeek Harness Web sidebar.
从 DeepSeek Harness Web 侧边栏永久删除对话。

- [中文](#中文)
- [English](#english)

---

## 中文

### 简介

DSH 的会话菜单只能归档，不能删除本地记录。这个插件在会话的“…”菜单里加一项 **删除对话**：确认后立即从侧边栏移除，并删除磁盘上的会话日志。

### 功能

- 会话“…”菜单中的“删除对话”，使用内置垃圾桶图标，风格与其它菜单项一致
- 自定义确认弹窗，不使用 `window.confirm`
- 先停止该会话正在运行的 agent
- 立即移除侧边栏行，无需刷新页面
- 先把会话目录移到回收目录，再后台删除，兼容 JSONL 持久化打开的写入句柄
- 尽力清理置顶状态

### 安装

要求：DSH 桌面版 `0.2.2-rc.1`（Web profile + JSONL 会话存储）。

#### 桌面端内添加（推荐）

1. 打开 **设置 → 插件**
2. 点 **Add plugin**
3. 在输入框粘贴下面任一地址，点 **Install**：
   - GitHub 仓库：`Littlehoax/dsh-session-purger`（或 `https://github.com/Littlehoax/dsh-session-purger.git`）
   - Release 压缩包：`https://github.com/Littlehoax/dsh-session-purger/releases/download/v0.1.0/dsh-session-purger-0.1.0.tgz`
   - 本地目录：`C:\path\to\dsh-session-purger`（绝对路径）
4. 安装完成后点 **Enable now**；如果菜单项没出现，刷新一次页面（Ctrl+R）

#### 其它安装方式

插件管理接口（`plugin_manager.install_bundle` / `dsh plugin add`）接受同样的地址，也支持 `file:` / `link:` 前缀和 npm 上的 `name[@range]`。目录安装创建的是 `link:` 依赖，不要删除或移动该目录。

### 使用

1. 打开任意会话右侧的“…”菜单
2. 点击 **删除对话**
3. 确认

删除是永久的，没有撤销，也没有回收站界面。

### 兼容性

插件使用了 DSH 的内部接口（`sessionPersistence.stat()`、session store 的 `detach()`、`api-session/removed`、Typert remote marker、`contextMenus`、`shell.overlay`）。DSH 大版本升级后可能失效；`engines.dsh` 会让不兼容的安装直接失败。

仅支持 JSONL 持久化的 `session.v4` 目录布局。

### 许可证

MIT

---

## English

### What it is

DSH can archive a conversation but never delete its local history. This plugin adds a **Delete conversation** action to every session's `…` menu. Confirming removes the session from the sidebar and deletes its log from disk.

### Features

- **Delete conversation** row in the session `…` menu, using the built-in trash glyph to match the other rows
- Custom confirmation dialog (no `window.confirm`)
- Stops a running agent for that session before deletion
- Removes the sidebar row immediately, no reload needed
- Moves the session directory to a trash folder first, then deletes it in the background, tolerating the open JSONL writer handle
- Best-effort pin cleanup

### Install

Requires DSH desktop `0.2.2-rc.1` (Web profile with JSONL session persistence).

#### From the desktop app (recommended)

1. Open **Settings → Plugins**
2. Click **Add plugin**
3. Paste one of these addresses and click **Install**:
   - GitHub repository: `Littlehoax/dsh-session-purger` (or `https://github.com/Littlehoax/dsh-session-purger.git`)
   - Release tarball: `https://github.com/Littlehoax/dsh-session-purger/releases/download/v0.1.0/dsh-session-purger-0.1.0.tgz`
   - Local directory: `C:\path\to\dsh-session-purger` (absolute path)
4. Click **Enable now** when it finishes; reload the page (Ctrl+R) if the menu row is missing

#### Other installation paths

The plugin manager API (`plugin_manager.install_bundle` / `dsh plugin add`) takes the same specs, plus `file:` / `link:` prefixes and npm `name[@range]`. A directory install creates a `link:` dependency — keep the directory in place.

### Usage

1. Open the `…` menu of any conversation
2. Click **Delete conversation**
3. Confirm

Deletion is permanent. There is no undo and no trash UI.

### Compatibility

The plugin relies on internal DSH seams (`sessionPersistence.stat()`, the session store's `detach()`, `api-session/removed`, the Typert remote marker, `contextMenus`, `shell.overlay`). A future DSH release may break it; `engines.dsh` makes an incompatible install fail loudly.

Only the JSONL `session.v4` on-disk layout is supported.

### License

MIT