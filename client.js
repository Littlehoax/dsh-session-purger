/**
 * Client half: three Session context-menu actions and the dialogs that confirm
 * them.
 *
 *  - "Delete conversation"      → `sessionDelete/delete`
 *  - "Delete conversation and artifacts" → `sessionDelete/artifacts` preview,
 *                                  then `sessionDelete/purge`
 *  - "Delete part of the conversation"   → `sessionDelete/outlines` picker,
 *                                  then `sessionDelete/truncate` (cut to the
 *                                  end) or `sessionDelete/removeRange` (an
 *                                  interior slice)
 *
 * The Sidebar drops a row when the Host announces `api-session/removed`.
 */
window.__ModuleLoader__.load({
  id: "dsh-session-purger",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const NS = "session-delete";

    const zh = {
      "menu.delete": "删除对话",
      "menu.purge": "删除对话和全部产物",
      "menu.slice": "删除指定片段…",
      "delete.title": "删除对话？",
      "delete.body": "“{title}”将从此设备删除，且无法恢复。",
      "delete.hint": "对话记录会从本机永久移除。",
      "purge.title": "删除对话和全部产物？",
      "purge.body": "“{title}”的对话记录，以及它在数据目录中的全部产物，都会被删除且无法恢复。",
      "purge.hint": "工作区里由对话产生的文件不受影响。",
      "purge.loading": "正在统计产物…",
      "purge.log": "对话记录",
      "purge.cache": "投影缓存",
      "purge.trash": "回收站残留",
      "purge.attachments": "独占附件",
      "purge.total": "合计",
      "purge.yes": "有",
      "purge.no": "无",
      "purge.items": "{count} 项",
      "purge.units": "{count} 个",
      "slice.title": "删除对话片段",
      "slice.body": "选择要删除的轮次。删除后，这条对话的记录会被就地重写，无法恢复。",
      "slice.loading": "正在读取对话…",
      "slice.mode.tail": "删到末尾",
      "slice.mode.range": "删除中间一段",
      "slice.tail.hint": "选中一轮，它和之后的所有轮次都会被删除。",
      "slice.range.hint": "依次选中起始轮和结束轮，只删除这一段。",
      "slice.turn": "第 {turn} 轮",
      "slice.no-prompt": "（无提问）",
      "slice.empty": "这条对话里没有可单独删除的轮次。",
      "slice.compacted": "已压缩",
      "slice.compacted-hint": "选中范围内有已被压缩摘要覆盖的轮次，可能无法安全删除。",
      "slice.summary": "将删除 {count} 轮（第 {from}–{to} 轮）。",
      "slice.open-hint": "这条对话正在打开状态，请先切换到别的对话再删除片段。",
      "dialog.cancel": "取消",
      "dialog.untitled": "未命名对话",
      "dialog.delete": "删除",
      "dialog.deleting": "正在删除…",
      "dialog.purging": "正在清理…",
      "dialog.slicing": "正在重写…",
      "error.not-found": "这条对话已经不存在了。",
      "error.busy": "对话仍在写入，请稍后再试。",
      "error.range": "选择的范围无法删除，请重新选择。",
      "error.conflict": "选中的片段被压缩摘要覆盖，无法安全删除。请换一个范围。",
      "error.corrupt": "对话记录结构异常，已取消操作。",
      "error.io-failed": "无法完成操作：{message}",
      "error.unavailable": "连不上后台，请重试。",
      "error.unknown": "操作失败，请重试。",
    };

    const en = {
      "menu.delete": "Delete conversation",
      "menu.purge": "Delete conversation and artifacts",
      "menu.slice": "Delete part of the conversation…",
      "delete.title": "Delete conversation?",
      "delete.body": "“{title}” will be deleted from this device. This cannot be undone.",
      "delete.hint": "The conversation history is removed permanently.",
      "purge.title": "Delete conversation and artifacts?",
      "purge.body": "“{title}”, along with everything it owns in the data directory, will be deleted. This cannot be undone.",
      "purge.hint": "Files the conversation produced in your workspace are left untouched.",
      "purge.loading": "Collecting artifacts…",
      "purge.log": "Conversation log",
      "purge.cache": "Projection cache",
      "purge.trash": "Trash residue",
      "purge.attachments": "Exclusive attachments",
      "purge.total": "Total",
      "purge.yes": "yes",
      "purge.no": "none",
      "purge.items": "{count} items",
      "purge.units": "{count}",
      "slice.title": "Delete part of the conversation",
      "slice.body": "Pick the turns to remove. The conversation log is rewritten in place, and this cannot be undone.",
      "slice.loading": "Reading the conversation…",
      "slice.mode.tail": "Cut to the end",
      "slice.mode.range": "Remove a middle slice",
      "slice.tail.hint": "Pick one turn: it and every later turn are removed.",
      "slice.range.hint": "Pick the first and the last turn of the slice to remove.",
      "slice.turn": "Turn {turn}",
      "slice.no-prompt": "(no prompt)",
      "slice.empty": "This conversation has no turn that can be removed on its own.",
      "slice.compacted": "compacted",
      "slice.compacted-hint": "The selected slice contains turns covered by a compaction summary and may not be removable.",
      "slice.summary": "{count} turn(s) will be removed (turns {from}–{to}).",
      "slice.open-hint": "This conversation is open. Switch to another conversation before removing turns.",
      "dialog.cancel": "Cancel",
      "dialog.untitled": "Untitled conversation",
      "dialog.delete": "Delete",
      "dialog.deleting": "Deleting…",
      "dialog.purging": "Purging…",
      "dialog.slicing": "Rewriting…",
      "error.not-found": "This conversation no longer exists.",
      "error.busy": "The conversation is still being written. Try again in a moment.",
      "error.range": "That range cannot be removed. Pick another one.",
      "error.conflict": "The selected slice is covered by a compaction summary and cannot be removed safely.",
      "error.corrupt": "The conversation log looks inconsistent, so nothing was changed.",
      "error.io-failed": "The operation could not finish: {message}",
      "error.unavailable": "The app is not reachable. Try again.",
      "error.unknown": "That did not work. Try again.",
    };

    // One pending request at a time; nothing is held while no dialog is open.
    const listeners = new Set();
    let request = null;
    const requestStore = {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot() {
        return request;
      },
    };
    const publish = (next) => {
      request = next;
      for (const listener of [...listeners]) listener();
    };
    /** Update the pending request only if it still describes the same target. */
    const patch = (kind, sessionId, changes) => {
      if (request === null || request.kind !== kind || request.sessionId !== sessionId) return;
      publish({ ...request, ...changes });
    };
    const closeDialog = () => {
      if (request === null) return;
      if (request.phase === "deleting") return;
      publish(null);
    };

    const errorText = (t, error) => {
      const code = typeof error?.code === "string" ? error.code : "";
      if (code === "session-delete/not-found") return t("error.not-found");
      if (code === "session-delete/busy") return t("error.busy");
      if (code === "session-delete/range") return t("error.range");
      if (code === "session-delete/conflict") return t("error.conflict");
      if (code === "session-delete/corrupt") return t("error.corrupt");
      if (code === "session-delete/io-failed") return t("error.io-failed", { message: error.message });
      if (error instanceof Error && error.message !== "") return error.message;
      return t("error.unknown");
    };

    /** Render a byte count at human scale. */
    const formatBytes = (value) => {
      const size = typeof value === "number" && value > 0 ? value : 0;
      if (size < 1024) return `${size} B`;
      const units = ["KB", "MB", "GB", "TB"];
      let scaled = size / 1024;
      let unit = 0;
      while (scaled >= 1024 && unit < units.length - 1) {
        scaled /= 1024;
        unit += 1;
      }
      return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`;
    };

    const backdropStyle = {
      position: "fixed",
      inset: 0,
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      background: "var(--dsw-alias-bg-overlay)",
      pointerEvents: "auto",
    };
    const cardStyle = {
      width: "min(480px, calc(100vw - 48px))",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      padding: "20px 22px 16px",
      borderRadius: 12,
      border: "1px solid var(--dsw-alias-border-l1)",
      background: "var(--dsw-alias-bg-layer-1)",
      color: "var(--dsw-alias-label-primary)",
      boxShadow: "0 18px 48px rgba(0, 0, 0, 0.28)",
      outline: "none",
    };
    const titleStyle = { margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.4 };
    const bodyStyle = { margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--dsw-alias-label-primary)" };
    const hintStyle = { margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-secondary)" };
    const errorStyle = { margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-state-error-primary)" };
    const warnStyle = { margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-state-warning-primary)" };
    const strongHintStyle = { ...hintStyle, color: "var(--dsw-alias-label-primary)" };
    const footerStyle = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 };
    const buttonStyle = {
      padding: "6px 14px",
      borderRadius: 8,
      border: "1px solid var(--dsw-alias-border-l1)",
      background: "transparent",
      color: "var(--dsw-alias-label-primary)",
      fontSize: 13,
      lineHeight: 1.5,
      cursor: "pointer",
    };
    const dangerStyle = {
      borderColor: "var(--dsw-alias-state-error-primary)",
      color: "var(--dsw-alias-state-error-primary)",
    };
    const disabledStyle = { opacity: 0.55, cursor: "default" };
    const listStyle = {
      display: "flex",
      flexDirection: "column",
      gap: 4,
      maxHeight: "min(44vh, 340px)",
      overflowY: "auto",
      padding: "2px 2px 2px 0",
    };
    const rowStyle = (selected) => ({
      display: "flex",
      alignItems: "center",
      gap: 8,
      width: "100%",
      padding: "6px 10px",
      borderRadius: 8,
      border: `1px solid ${selected ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-border-l1)"}`,
      background: selected ? "var(--dsw-alias-bg-layer-2)" : "transparent",
      color: "var(--dsw-alias-label-primary)",
      fontSize: 12,
      lineHeight: 1.4,
      textAlign: "left",
      cursor: "pointer",
    });
    const tabStyle = (active) => ({
      padding: "4px 12px",
      borderRadius: 999,
      border: `1px solid ${active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-border-l1)"}`,
      background: "transparent",
      color: "var(--dsw-alias-label-primary)",
      fontSize: 12,
      lineHeight: 1.5,
      cursor: "pointer",
      opacity: active ? 1 : 0.75,
    });
    const badgeStyle = {
      flex: "0 0 auto",
      padding: "0 6px",
      borderRadius: 999,
      fontSize: 10,
      lineHeight: "16px",
      color: "var(--dsw-alias-state-warning-primary)",
      border: "1px solid var(--dsw-alias-state-warning-primary)",
    };

    return {
      inject: ["slots", "locale", "contextMenus"],
      apply(ctx) {
        const tn = ctx.locale.bind(NS);

        ctx.effect(() => {
          const disposers = [
            ctx.locale.register(NS, "zh", zh),
            ctx.locale.register(NS, "en", en),
          ];
          return () => {
            for (const dispose of disposers) dispose?.();
          };
        }, "session-delete: dictionaries");

        /** Call one Host Remote method on this bundle's service. */
        const call = async (method, args) => {
          const connection = ctx.get("connection");
          if (connection === undefined || typeof connection.rpc?.call !== "function") {
            throw new Error(tn("error.unavailable"));
          }
          const response = await connection.rpc.call("/api", `sessionDelete/${method}`, { args });
          if (response?.ok !== true) {
            const failure = new Error(response?.error?.message ?? "");
            if (typeof response?.error?.code === "string") failure.code = response.error.code;
            throw failure;
          }
          return response.value;
        };

        /** Drop the open conversation from the main surface when it was edited. */
        const releaseMain = (sessionId) => {
          const uiWorkspace = ctx.get("uiWorkspace");
          if (
            uiWorkspace !== undefined
            && uiWorkspace.mainReference?.sessionId === sessionId
            && typeof uiWorkspace.clearMain === "function"
          ) {
            uiWorkspace.clearMain();
          }
        };

        const openDelete = (sessionId, displayTitle) => {
          if (typeof sessionId !== "string" || sessionId === "") return;
          publish({
            kind: "delete",
            sessionId,
            title: typeof displayTitle === "string" ? displayTitle : "",
            phase: "confirm",
            message: "",
          });
        };

        const openPurge = (sessionId, displayTitle) => {
          if (typeof sessionId !== "string" || sessionId === "") return;
          publish({
            kind: "purge",
            sessionId,
            title: typeof displayTitle === "string" ? displayTitle : "",
            phase: "loading",
            message: "",
            plan: null,
          });
          void (async () => {
            try {
              const plan = await call("artifacts", { targetSessionId: sessionId });
              patch("purge", sessionId, { plan, phase: "confirm" });
            } catch (error) {
              patch("purge", sessionId, { phase: "confirm", message: errorText(tn, error) });
            }
          })();
        };

        const openSlice = (sessionId, displayTitle) => {
          if (typeof sessionId !== "string" || sessionId === "") return;
          publish({
            kind: "slice",
            sessionId,
            title: typeof displayTitle === "string" ? displayTitle : "",
            phase: "loading",
            message: "",
            mode: "tail",
            outline: null,
            from: null,
            to: null,
          });
          void (async () => {
            try {
              const outline = await call("outlines", { targetSessionId: sessionId });
              patch("slice", sessionId, { outline, phase: "confirm" });
            } catch (error) {
              patch("slice", sessionId, { phase: "confirm", message: errorText(tn, error) });
            }
          })();
        };

        /** One dialog for every action; the request decides what is shown. */
        function PurgeDialog({ t }) {
          const current = React.useSyncExternalStore(requestStore.subscribe, requestStore.getSnapshot);
          const cardRef = React.useRef(null);
          const open = current !== null;
          const busy = current?.phase === "deleting";
          const interactive = current?.phase === "confirm";

          React.useEffect(() => {
            if (!open) return undefined;
            cardRef.current?.focus();
            const onKeyDown = (event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              closeDialog();
            };
            document.addEventListener("keydown", onKeyDown, true);
            return () => document.removeEventListener("keydown", onKeyDown, true);
          }, [open]);

          if (current === null) return null;

          const finish = () => {
            releaseMain(current.sessionId);
            publish(null);
          };
          const attempt = async (action) => {
            publish({ ...request, phase: "deleting", message: "" });
            try {
              await action();
              finish();
            } catch (error) {
              if (request === null) return;
              publish({ ...request, phase: "confirm", message: errorText(t, error) });
            }
          };

          const runDelete = () => attempt(
            () => call("delete", { targetSessionId: current.sessionId }),
          );
          const runPurge = () => attempt(
            () => call("purge", { targetSessionId: current.sessionId }),
          );
          const runSlice = () => {
            const from = current.from;
            if (typeof from !== "number") return;
            if (current.mode === "tail") {
              return attempt(
                () => call("truncate", { targetSessionId: current.sessionId, cutTurn: from }),
              );
            }
            const to = current.to;
            if (typeof to !== "number") return;
            return attempt(
              () => call("removeRange", { targetSessionId: current.sessionId, fromTurn: from, toTurn: to }),
            );
          };

          const pick = (turn) => {
            if (!interactive) return;
            if (current.mode === "tail") {
              publish({ ...current, from: turn, to: null, message: "" });
              return;
            }
            if (current.from === null || current.to !== null) {
              publish({ ...current, from: turn, to: null, message: "" });
              return;
            }
            const from = Math.min(current.from, turn);
            const to = Math.max(current.from, turn);
            publish({ ...current, from, to, message: "" });
          };

          const setMode = (mode) => {
            if (!interactive) return;
            publish({ ...current, mode, from: null, to: null, message: "" });
          };

          const section = () => {
            if (current.kind === "purge") {
              if (current.plan === null) {
                return h("p", { style: hintStyle }, t("purge.loading"));
              }
              const plan = current.plan;
              const attachmentBytes = plan.attachments.reduce((sum, item) => sum + item.bytes, 0);
              const row = (label, value) => h(
                "div",
                { key: label, style: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 } },
                h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, label),
                h("span", { style: { textAlign: "right" } }, value),
              );
              return h(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: 4 } },
                row(
                  t("purge.log"),
                  plan.log === null ? t("purge.no") : formatBytes(plan.log.bytes),
                ),
                row(t("purge.cache"), plan.cache ? t("purge.yes") : t("purge.no")),
                row(t("purge.trash"), t("purge.items", { count: plan.trash.length })),
                row(
                  t("purge.attachments"),
                  plan.attachments.length === 0
                    ? t("purge.no")
                    : `${t("purge.units", { count: plan.attachments.length })} · ${formatBytes(attachmentBytes)}`,
                ),
                h("div", { style: { ...strongHintStyle, marginTop: 2 } }, `${t("purge.total")} ${formatBytes(plan.totalBytes)}`),
              );
            }
            if (current.kind !== "slice") return null;
            if (current.outline === null) {
              return h("p", { style: hintStyle }, t("slice.loading"));
            }
            const turns = current.outline.turns;
            if (turns.length === 0) {
              return h("p", { style: hintStyle }, t("slice.empty"));
            }
            const selected = (turn) => {
              if (current.from === null) return false;
              if (current.mode === "tail") return turn >= current.from;
              if (current.to === null) return turn === current.from;
              return turn >= current.from && turn <= current.to;
            };
            const picked = turns.filter((turn) => selected(turn.turn));
            const compacted = picked.some((turn) => turn.compacted);
            const isOpen = ctx.get("uiWorkspace")?.mainReference?.sessionId === current.sessionId;
            return h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 8 } },
              h(
                "div",
                { style: { display: "flex", gap: 6 } },
                h(
                  "button",
                  { type: "button", onClick: () => setMode("tail"), style: tabStyle(current.mode === "tail") },
                  t("slice.mode.tail"),
                ),
                h(
                  "button",
                  { type: "button", onClick: () => setMode("range"), style: tabStyle(current.mode === "range") },
                  t("slice.mode.range"),
                ),
              ),
              h("p", { style: hintStyle }, current.mode === "tail" ? t("slice.tail.hint") : t("slice.range.hint")),
              h(
                "div",
                { style: listStyle },
                ...turns.map((turn) => h(
                  "button",
                  {
                    key: turn.turn,
                    type: "button",
                    onClick: () => pick(turn.turn),
                    style: rowStyle(selected(turn.turn)),
                  },
                  h(
                    "span",
                    { style: { flex: "0 0 auto", color: "var(--dsw-alias-label-secondary)", fontSize: 11 } },
                    t("slice.turn", { turn: turn.turn }),
                  ),
                  h(
                    "span",
                    {
                      style: {
                        flex: "1 1 auto",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      },
                    },
                    turn.prompt === "" ? t("slice.no-prompt") : turn.prompt,
                  ),
                  turn.compacted ? h("span", { style: badgeStyle }, t("slice.compacted")) : null,
                )),
              ),
              picked.length > 0
                ? h(
                  "p",
                  { style: strongHintStyle },
                  t("slice.summary", {
                    count: picked.length,
                    from: picked[0].turn,
                    to: picked[picked.length - 1].turn,
                  }),
                )
                : null,
              compacted ? h("p", { style: warnStyle }, t("slice.compacted-hint")) : null,
              isOpen ? h("p", { style: warnStyle }, t("slice.open-hint")) : null,
            );
          };

          const titles = {
            delete: t("delete.title"),
            purge: t("purge.title"),
            slice: t("slice.title"),
          };
          const bodies = {
            delete: t("delete.body", { title: current.title === "" ? t("dialog.untitled") : current.title }),
            purge: t("purge.body", { title: current.title === "" ? t("dialog.untitled") : current.title }),
            slice: t("slice.body"),
          };
          const hints = {
            delete: t("delete.hint"),
            purge: t("purge.hint"),
            slice: null,
          };
          const labels = {
            delete: busy ? t("dialog.deleting") : t("dialog.delete"),
            purge: busy ? t("dialog.purging") : t("dialog.delete"),
            slice: busy ? t("dialog.slicing") : t("dialog.delete"),
          };
          const runners = { delete: runDelete, purge: runPurge, slice: runSlice };
          const openHere = current.kind === "slice"
            && ctx.get("uiWorkspace")?.mainReference?.sessionId === current.sessionId;
          const actionable = current.kind === "delete"
            ? current.phase === "confirm"
            : current.phase === "confirm" && (
              current.kind === "purge"
                ? current.plan !== null
                : !openHere
                  && current.outline !== null
                  && current.from !== null
                  && (current.mode === "tail" || current.to !== null)
            );

          return h(
            "div",
            {
              style: backdropStyle,
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) closeDialog();
              },
            },
            h(
              "div",
              {
                ref: cardRef,
                role: "dialog",
                "aria-modal": "true",
                "aria-labelledby": "session-delete-title",
                tabIndex: -1,
                style: cardStyle,
              },
              h("h2", { id: "session-delete-title", style: titleStyle }, titles[current.kind]),
              h("p", { style: bodyStyle }, bodies[current.kind]),
              hints[current.kind] === null ? null : h("p", { style: hintStyle }, hints[current.kind]),
              section(),
              current.message !== "" ? h("p", { style: errorStyle, role: "alert" }, current.message) : null,
              h(
                "div",
                { style: footerStyle },
                h(
                  "button",
                  {
                    type: "button",
                    disabled: busy,
                    onClick: closeDialog,
                    style: busy ? { ...buttonStyle, ...disabledStyle } : buttonStyle,
                  },
                  t("dialog.cancel"),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    disabled: busy || !actionable,
                    onClick: () => {
                      void runners[current.kind]();
                    },
                    style: {
                      ...buttonStyle,
                      ...dangerStyle,
                      ...(busy || !actionable ? disabledStyle : {}),
                    },
                  },
                  labels[current.kind],
                ),
              ),
            ),
          );
        }

        ctx.slots.inject("shell.overlay", function* () {
          yield ctx.slots.register(
            { name: "shell.overlay", id: "session-delete.confirm", locale: NS },
            PurgeDialog,
          );
        });

        ctx.effect(() => ctx.contextMenus.register({
          id: "session.delete",
          target: "session",
          order: 700,
          observe: () => [ctx.locale],
          resolve: (target) => [
            {
              id: "delete",
              label: ctx.locale.bind(NS)("menu.delete"),
              icon: { key: "workspace.delete" },
              danger: true,
              separatorBefore: true,
              run: () => openDelete(target.sessionId, target.displayTitle),
            },
            {
              id: "purge",
              label: ctx.locale.bind(NS)("menu.purge"),
              icon: { key: "workspace.delete" },
              danger: true,
              run: () => openPurge(target.sessionId, target.displayTitle),
            },
            {
              id: "slice",
              label: ctx.locale.bind(NS)("menu.slice"),
              icon: { key: "workspace.rename" },
              run: () => openSlice(target.sessionId, target.displayTitle),
            },
          ],
        }), "session-delete: menu");
      },
    };
  },
});