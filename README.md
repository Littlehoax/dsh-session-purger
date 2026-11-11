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

用插件管理安装，target 支持以下形式：

| 来源 | 示例 |
| --- | --- |
| 本地目录 | `C:\path\to\dsh-session-purger` |
| 压缩包 | `https://github.com/Littlehoax/dsh-session-purger/releases/download/v0.1.0/dsh-session-purger-0.1.0.tgz` |
| Git 仓库 | `Littlehoax/dsh-session-purger` |
| npm | 暂未发布 |

目录安装是 `link:` 依赖，不要删除或移动该目录。安装后客户端部分会热加载；如果菜单没出现，刷新一次页面。

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

Install through the plugin manager with one of these targets:

| Source | Example |
| --- | --- |
| Local directory | `C:\path\to\dsh-session-purger` |
| Tarball | `https://github.com/Littlehoax/dsh-session-purger/releases/download/v0.1.0/dsh-session-purger-0.1.0.tgz` |
| Git repository | `Littlehoax/dsh-session-purger` |
| npm | not published yet |

A directory install is a `link:` dependency — keep the directory in place. The client half hot-loads; if the menu entry is missing, reload the page once.

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