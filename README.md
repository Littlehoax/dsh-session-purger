# dsh-session-purger

在 DSH Web 侧边栏中永久删除对话。
Permanently delete conversations from the DSH Web sidebar.

## 中文

### 功能

- 在会话的“…”菜单里加一项 **删除对话**，使用内置垃圾桶图标，与其它菜单项风格一致
- 确认后立即从侧边栏移除，并删除磁盘上的会话记录
- 删除前先停止该会话正在运行的 agent
- 自己的确认弹窗（不用 `window.confirm`），没有撤销
- 兼容 JSONL 持久化打开的写入句柄；尽力清理置顶状态

### 安装

要求 DSH 桌面版 `0.2.2-rc.1`。

打开 **设置 → 插件 → Add plugin**，输入：

```
dsh-session-purger
```

点 **Install**，再点 **Enable now**。不需要 Git。

离线或访问 GitHub 受限时，也可以改用 Release 的 `.tgz` 地址或本地绝对路径安装。

### 使用

会话右侧“…”→ **删除对话** → 确认。删除不可恢复。

### 兼容性

仅支持 JSONL `session.v4` 布局；依赖 DSH 内部会话接口，大版本升级可能失效。MIT。

## English

### Features

- **Delete conversation** row in the session `…` menu, using the built-in trash icon to match the other rows
- Removes the sidebar row immediately and deletes the on-disk session log
- Stops a running agent for that session first
- Custom confirmation dialog, no undo
- Tolerates the open JSONL writer handle; best-effort pin cleanup

### Install

Requires DSH desktop `0.2.2-rc.1`.

Open **Settings → Plugins → Add plugin** and enter:

```
dsh-session-purger
```

Click **Install**, then **Enable now**. No Git needed.

If offline or GitHub is blocked, install from the release `.tgz` URL or a local absolute path instead.

### Usage

Session `…` menu → **Delete conversation** → confirm. Permanent, no undo.

### Compatibility

JSONL `session.v4` layout only; relies on internal DSH seams and may break on a major DSH upgrade. MIT.