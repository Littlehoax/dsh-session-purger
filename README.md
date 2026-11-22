# dsh-session-purger

Delete conversations, trim a slice of their turns from the message row, and purge the files they own in the DSH Web sidebar.
从 DSH Web 侧边栏里删除对话、在消息上裁掉对话里的某一段，并清理这条对话留下的全部产物。

## 中文

### 这个插件做什么

DSH 的会话菜单里只有“归档”。归档只是把对话从侧边栏藏起来，磁盘上的记录还在。

这个插件补了两处入口：会话“…”菜单里的两项，以及每条 AI 回复下方图标行里的一个剪刀按钮。

会话“…”菜单：

- **删除对话** —— 整个对话从侧边栏消失，会话记录也从磁盘移除。
- **删除对话和全部产物** —— 在上一项的基础上，再清掉这条对话在 DSH 数据目录里留下的一切：会话记录、投影缓存（`storages/session_projcache`）、回收站里残留的副本，以及只有这条对话引用的附件对象。工作区里由对话产生的文件不动。删除前会先列一份清单，写清每一项占多少空间，确认后才动手。

消息图标行（就在“复制”旁边）：

- **剪刀按钮：删除这一段对话** —— 每条 AI 回复下方都有，点它打开片段选择器，并自动选中这条回复所属的那一轮。只删掉对话里的某几轮，其余内容保留：
  - **删到末尾**：选中一轮，它和之后的所有轮次都删掉（回到那一轮之前的状态）。
  - **删除中间一段**：选中起始和结束两轮，只删这一段，后面的对话接上继续。

  片段删除会把这条对话的记录就地重写：事件序号重新连续，引用关系（压缩摘要覆盖的范围、工具调用改写、开发者消息引用的请求头）会跟着重映射。如果选中的片段已经被压缩摘要覆盖、无法安全重写，插件会拒绝并说明原因，不会删坏记录。

删除前都会先停掉这条会话正在运行的 agent，免得一边写一边删。确认框是插件自带的小弹窗，不会弹系统那种 `window.confirm`。

只有**当前正显示在主面板里的那条对话**不能删片段——它占着写句柄，删了面板就没内容了。先切到别的对话再删即可；其它之前打开过的对话不用管，插件会自己把它的写句柄放掉再重写。

### 安装

需要 DSH 桌面版 `0.2.2-rc.1` 及以上。

打开 **设置 → 插件 → Add plugin**，输入 `dsh-session-purger`，点 **Install**，再点 **Enable now** 就行，不需要装 Git。

如果所在网络访问 npm 或 GitHub 不方便，也可以去 Release 页面下载 `.tgz`，用本地文件安装。

### 使用

在会话右侧点“…”：

- **删除对话** → 确认。
- **删除对话和全部产物** → 看一眼清单 → 确认。

片段删除在消息上：把鼠标移到任意一条 AI 回复，图标行里“复制”旁边会出现剪刀按钮，点开选「删到末尾」或「删除中间一段」→ 点选轮次 → 确认。

删掉就没了，没有撤销，也没有回收站。删之前想清楚。

### 兼容性

目前适配的是 JSONL 的 `session.v4` 存储格式，并用到了几个 DSH 内部接口，所以 DSH 大版本升级之后有可能失效。真遇到问题，欢迎开 issue。

MIT 许可。

## English

### What it does

DSH's session menu can archive a conversation, but archiving only hides it from the sidebar — the log stays on disk.

This plugin adds two entry points: two items in the session `…` menu, and one button in the icon row under every AI reply.

Session `…` menu:

- **Delete conversation** — the row disappears from the sidebar immediately and the session log is removed from disk.
- **Delete conversation and artifacts** — the same, plus everything that conversation owns inside the DSH data directory: its log, its projection cache row (`storages/session_projcache`), leftover copies in the trash folder, and the attachment objects only it references. Files the conversation produced in your workspace are left alone. A summary is shown first, with the size of each item, and nothing is removed until you confirm.

Message icon row (right beside **Copy**):

- **Scissors: delete part of this conversation** — present under every AI reply; it opens the slice picker with the turn that reply closes already selected. A few turns are removed and the rest kept:
  - **Cut to the end**: pick a turn and it plus every later turn is removed, taking the conversation back to just before it.
  - **Remove a middle slice**: pick the first and the last turn of the block; the later turns move up to follow the earlier ones.

  A slice edit rewrites the log in place: sequence numbers are made contiguous again and every seq-keyed reference is remapped (compaction shadow ranges, tool rewrites, developer-message header cites). If the chosen slice is already covered by a compaction summary and cannot be rewritten safely, the plugin refuses and says why instead of corrupting the log.

Every action stops any agent still running for that session first, so nothing keeps writing while the file is being rewritten. The confirmation is a small in-app dialog rather than a `window.confirm`.

Only the conversation **currently displayed in the main pane** cannot have a slice removed — it holds the write handle, and removing its content would leave the pane blank. Switch to another conversation first; other conversations you opened earlier need no attention, the plugin releases their handle before rewriting.

### Install

Requires DSH desktop `0.2.2-rc.1` or later.

Open **Settings → Plugins → Add plugin**, enter `dsh-session-purger`, then click **Install** and **Enable now**. No Git needed.

If npm or GitHub is hard to reach from your network, download the `.tgz` from the release page and install from that local file instead.

### Usage

Session `…` menu:

- **Delete conversation** → confirm.
- **Delete conversation and artifacts** → review the summary → confirm.

Slice removal lives on the message: hover any AI reply and a scissors button appears next to **Copy** in its icon row. Click it, choose *Cut to the end* or *Remove a middle slice* → pick the turns → confirm.

Once deleted, it's gone — no undo and no trash bin. Make sure that's what you want.

### Compatibility

Built for the JSONL `session.v4` layout and a few internal DSH seams, so a major DSH update may break it. If that happens, please open an issue.

MIT.