/**
 * Client half: a "Delete conversation" row in a Session's context menu and a
 * confirmation dialog rendered into the frame-wide overlay layer. The dialog
 * invokes the Host Remote `sessionDelete/delete`; the Sidebar drops the row
 * when the Host announces `api-session/removed`.
 */
window.__ModuleLoader__.load({
  id: "dsh-session-purger",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const NS = "session-delete";

    const zh = {
      "menu.delete": "删除对话",
      "dialog.title": "删除对话？",
      "dialog.body": "“{title}”将从此设备删除，且无法恢复。",
      "dialog.hint": "对话记录会从本机永久移除。",
      "dialog.untitled": "未命名对话",
      "dialog.cancel": "取消",
      "dialog.delete": "删除",
      "dialog.deleting": "正在删除…",
      "error.not-found": "这条对话已经不存在了。",
      "error.busy": "对话仍在写入，请稍后再试。",
      "error.io-failed": "无法删除对话文件：{message}",
      "error.unavailable": "连不上后台，请重试。",
      "error.unknown": "删除失败，请重试。",
    };

    const en = {
      "menu.delete": "Delete conversation",
      "dialog.title": "Delete conversation?",
      "dialog.body": "“{title}” will be deleted from this device. This cannot be undone.",
      "dialog.hint": "The conversation history is removed permanently.",
      "dialog.untitled": "Untitled conversation",
      "dialog.cancel": "Cancel",
      "dialog.delete": "Delete",
      "dialog.deleting": "Deleting…",
      "error.not-found": "This conversation no longer exists.",
      "error.busy": "The conversation is still being written. Try again in a moment.",
      "error.io-failed": "Could not delete the conversation files: {message}",
      "error.unavailable": "The app is not reachable. Try again.",
      "error.unknown": "The conversation could not be deleted. Try again.",
    };

    // One pending confirmation at a time; nothing is held while no dialog is open.
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
    const openDialog = (sessionId, displayTitle) => {
      if (typeof sessionId !== "string" || sessionId === "") return;
      publish({
        sessionId,
        title: typeof displayTitle === "string" ? displayTitle : "",
        phase: "confirm",
        message: "",
      });
    };
    const closeDialog = () => {
      if (request?.phase === "deleting") return;
      publish(null);
    };
    const failDialog = (message) => {
      if (request === null) return;
      publish({ ...request, phase: "error", message });
    };

    const errorText = (t, error) => {
      const code = typeof error?.code === "string" ? error.code : "";
      if (code === "session-delete/not-found") return t("error.not-found");
      if (code === "session-delete/busy") return t("error.busy");
      if (code === "session-delete/io-failed") return t("error.io-failed", { message: error.message });
      if (error instanceof Error && error.message !== "") return error.message;
      return t("error.unknown");
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
      width: "min(430px, calc(100vw - 48px))",
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

    return {
      inject: ["slots", "locale", "contextMenus"],
      apply(ctx) {
        ctx.effect(() => {
          const disposers = [
            ctx.locale.register(NS, "zh", zh),
            ctx.locale.register(NS, "en", en),
          ];
          return () => {
            for (const dispose of disposers) dispose?.();
          };
        }, "session-delete: dictionaries");

        /** Frame-wide confirmation dialog; rendered only while a request is pending. */
        function DeleteDialog({ t }) {
          const current = React.useSyncExternalStore(requestStore.subscribe, requestStore.getSnapshot);
          const cardRef = React.useRef(null);
          const open = current !== null;
          const deleting = current?.phase === "deleting";

          React.useEffect(() => {
            if (!open) return undefined;
            cardRef.current?.focus();
            const onKeyDown = (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeDialog();
              }
            };
            document.addEventListener("keydown", onKeyDown, true);
            return () => document.removeEventListener("keydown", onKeyDown, true);
          }, [open]);

          if (current === null) return null;

          const remove = async () => {
            if (request === null || request.phase !== "confirm") return;
            const sessionId = request.sessionId;
            publish({ ...request, phase: "deleting", message: "" });
            try {
              const connection = ctx.get("connection");
              if (connection === undefined || typeof connection.rpc?.call !== "function") {
                throw new Error(t("error.unavailable"));
              }
              const response = await connection.rpc.call("/api", "sessionDelete/delete", {
                args: { targetSessionId: sessionId },
              });
              if (response?.ok !== true) {
                const failure = new Error(response?.error?.message ?? "");
                if (typeof response?.error?.code === "string") failure.code = response.error.code;
                throw failure;
              }
              const uiWorkspace = ctx.get("uiWorkspace");
              if (
                uiWorkspace !== undefined
                && uiWorkspace.mainReference?.sessionId === sessionId
                && typeof uiWorkspace.clearMain === "function"
              ) {
                uiWorkspace.clearMain();
              }
              publish(null);
            } catch (error) {
              failDialog(errorText(t, error));
            }
          };

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
                "aria-describedby": "session-delete-body",
                tabIndex: -1,
                style: cardStyle,
              },
              h("h2", { id: "session-delete-title", style: titleStyle }, t("dialog.title")),
              h(
                "p",
                { id: "session-delete-body", style: bodyStyle },
                t("dialog.body", { title: current.title === "" ? t("dialog.untitled") : current.title }),
              ),
              h("p", { style: hintStyle }, t("dialog.hint")),
              current.message !== "" && h("p", { style: errorStyle, role: "alert" }, current.message),
              h(
                "div",
                { style: footerStyle },
                h(
                  "button",
                  {
                    type: "button",
                    disabled: deleting,
                    onClick: closeDialog,
                    style: deleting ? { ...buttonStyle, ...disabledStyle } : buttonStyle,
                  },
                  t("dialog.cancel"),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    disabled: deleting,
                    onClick: () => {
                      void remove();
                    },
                    style: { ...buttonStyle, ...dangerStyle, ...(deleting ? disabledStyle : {}) },
                  },
                  deleting ? t("dialog.deleting") : t("dialog.delete"),
                ),
              ),
            ),
          );
        }

        ctx.slots.inject("shell.overlay", function* () {
          yield ctx.slots.register(
            { name: "shell.overlay", id: "session-delete.confirm", locale: NS },
            DeleteDialog,
          );
        });

        ctx.effect(() => ctx.contextMenus.register({
          id: "session.delete",
          target: "session",
          order: 700,
          observe: () => [ctx.locale],
          resolve: (target) => [{
            id: "delete",
            label: ctx.locale.bind(NS)("menu.delete"),
            icon: { key: "workspace.delete" },
            separatorBefore: true,
            run: () => openDialog(target.sessionId, target.displayTitle),
          }],
        }), "session-delete: menu");
      },
    };
  },
});