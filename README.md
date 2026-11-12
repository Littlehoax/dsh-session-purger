# dsh-session-purger

Permanently delete conversations from the DSH Web sidebar.
从 DSH Web 侧边栏里彻底删除对话。

## 中文

### 这个插件做什么

DSH 的会话菜单里只有“归档”。归档只是把对话从侧边栏藏起来，磁盘上的记录还在。

这个插件补上真正删除的能力：在会话的“…”菜单里加一项 **删除对话**。确认之后，对话会立刻从侧边栏消失，对应的会话记录也会从磁盘上删掉。

删除前会先停掉这个会话正在运行的 agent，免得一边写一边删。确认框是插件自带的小弹窗，不会弹系统那种 `window.confirm`。

### 安装

需要 DSH 桌面版 `0.2.2-rc.1`。

打开 **设置 → 插件 → Add plugin**，输入 `dsh-session-purger`，点 **Install**，再点 **Enable now** 就行，不需要装 Git。

如果所在网络访问 npm 或 GitHub 不方便，也可以去 Release 页面下载 `.tgz`，用本地文件安装。

### 使用

在会话右侧点“…”→ **删除对话** → 确认。

删掉就没了，没有撤销，也没有回收站。删之前想清楚。

### 兼容性

目前适配的是 JSONL 的 `session.v4` 存储格式，并用到了几个 DSH 内部接口，所以 DSH 大版本升级之后有可能失效。真遇到问题，欢迎开 issue。

MIT 许可。

## English

### What it does

DSH's session menu can archive a conversation, but archiving only hides it from the sidebar — the log stays on disk.

This plugin adds the missing piece: a **Delete conversation** action in the session's `…` menu. Once you confirm, the row disappears from the sidebar immediately and the session log is removed from disk.

Before deleting, it stops any agent still running for that session, so nothing keeps writing to the file while it is being removed. The confirmation is a small in-app dialog rather than a `window.confirm`.

### Install

Requires DSH desktop `0.2.2-rc.1`.

Open **Settings → Plugins → Add plugin**, enter `dsh-session-purger`, then click **Install** and **Enable now**. No Git needed.

If npm or GitHub is hard to reach from your network, download the `.tgz` from the release page and install from that local file instead.

### Usage

Session `…` menu → **Delete conversation** → confirm.

Once deleted, it's gone — no undo and no trash bin. Make sure that's what you want.

### Compatibility

Built for the JSONL `session.v4` layout and a few internal DSH seams, so a major DSH update may break it. If that happens, please open an issue.

MIT.