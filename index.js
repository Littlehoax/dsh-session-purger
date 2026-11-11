/**
 * Permanently delete one stored conversation.
 *
 * The Host owns the operation (`SessionDeleteService.delete`), the Client
 * invokes it through the Typert Gateway, and the Sidebar exposes it as a
 * context-menu action with a confirmation dialog.
 */
import { promises as fsp } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";

/** Prototype key read by the Typert Gateway's source-mode discovery. */
const REMOTE_METHODS = "@deepseek-ai/dsh-typert-protocol/remote-methods";
/** Host services this bundle reads through `ctx.<name>` property access. */
export const inject = ["sessionPersistence", "sessions", "agents"];
/** Characters kept literal in a session path segment. */
const SAFE_SEGMENT_CHAR = /^[A-Za-z0-9._-]$/;
/** Bound for a project directory name, matching the JSONL persistence layout. */
const PROJECT_KEY_LIMIT = 251;
/** Service key and Typert namespace of this bundle. */
const SERVICE_KEY = "sessionDelete";

/**
 * A failure the Typert Gateway forwards with its stable code. Defined here
 * instead of imported so the bundle depends only on Node built-ins; the
 * Gateway recognises Remote failures structurally (`isDSHRemoteError`).
 */
class RemoteFailure extends Error {
  /**
   * @param code - stable failure code consumed by the Client.
   * @param message - human diagnostic.
   */
  constructor(code, message) {
    super(message);
    this.name = "RemoteError";
    this.code = code;
    this.details = {};
    this.isDSHRemoteError = true;
  }
}

/**
 * Escape one arbitrary Session id into a single filesystem-safe segment.
 * Mirrors the JSONL persistence backend so a directory can be found without
 * asking the backend for it.
 * @param raw - the Session id.
 * @returns the encoded segment.
 */
function encodeSegment(raw) {
  if (raw.length === 0) throw new Error("cannot encode an empty path segment");
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character !== "~" && SAFE_SEGMENT_CHAR.test(character)) out += character;
    else out += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}

/**
 * Build the readable project directory key for a Session cwd.
 * @param cwd - absolute project directory.
 * @returns the project directory name under the session root.
 */
function projectKey(cwd) {
  if (cwd.length === 0) throw new Error("cannot encode an empty project path");
  let readable = "";
  let separatorRun = false;
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character === "/" || code === 92 || character === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (character !== "~" && SAFE_SEGMENT_CHAR.test(character)) {
      readable += character;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, PROJECT_KEY_LIMIT)}--`;
}

/** Resolve after one delay; used only for short best-effort settlements. */
function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Host service exposing one destructive user action: deleting a conversation.
 * Registered as the Typert namespace `sessionDelete`, so the Client reaches it
 * at `/api/sessionDelete/delete` through the Connection RPC.
 */
class SessionDeleteService {
  /**
   * @param ctx - owning Host Context.
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.typertRemote = Object.freeze({
      service: this,
      serviceKey: SERVICE_KEY,
      namespace: SERVICE_KEY,
    });
  }

  /**
   * Delete one stored Session: stop its work, detach its live entry, move its
   * log directory out of the session root, and announce the removal so every
   * open sidebar drops the row.
   * @param targetSessionId - Session identity to delete.
   * @param signal - cancellation from the Remote call.
   * @returns the deletion receipt.
   */
  async delete(targetSessionId, signal) {
    signal?.throwIfAborted();
    if (typeof targetSessionId !== "string" || targetSessionId.length === 0) {
      throw new RemoteFailure("session-delete/invalid", "A conversation id is required.");
    }
    const persistence = this.ctx.sessionPersistence;
    const root = typeof persistence?.root === "string" ? resolve(persistence.root) : undefined;
    const snapshot = await this.stat(targetSessionId, signal);
    const entry = this.ctx.sessions?.store?.get?.(targetSessionId);
    if (snapshot === undefined && entry === undefined) {
      throw new RemoteFailure("session-delete/not-found", "This conversation no longer exists.");
    }
    if (entry !== undefined && (entry.appending === true || entry.announcement === "dispatching")) {
      throw new RemoteFailure("session-delete/busy", "This conversation is still being written; try again in a moment.");
    }
    const agent = this.ctx.agents?.get?.(targetSessionId);
    if (agent !== undefined && typeof agent.cancel === "function") {
      try {
        await agent.cancel({ kind: "user" }, { keepInbox: false });
      } catch {
        // Cancelling an idle Agent is a no-op; a refusal must not block deletion.
      }
    }
    const announced = entry !== undefined && entry.announcement !== "pending";
    try {
      entry?.detach?.();
    } catch {
      // The Session may already have been detached by its owner.
    }
    if (agent !== undefined) await sleep(120);
    signal?.throwIfAborted();
    const directory = await this.locate(targetSessionId, snapshot, root);
    if (directory === undefined) {
      throw new RemoteFailure("session-delete/io-failed", "The conversation files could not be located.");
    }
    if (await this.exists(directory)) {
      const moved = await this.moveAside(directory, targetSessionId, root);
      if (moved !== undefined) {
        this.discardLater(moved);
      } else {
        try {
          await fsp.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
        } catch (error) {
          throw new RemoteFailure(
            "session-delete/io-failed",
            `Could not remove the conversation files: ${error?.message ?? String(error)}`,
          );
        }
      }
    } else {
      // A created-but-unflushed Session may still flush during teardown.
      this.discardLater(directory, 2500);
    }
    if (!announced) this.ctx.emit("api-session/removed", targetSessionId);
    try {
      await this.ctx.get("workspaceRegistry")?.unpinSession?.(targetSessionId);
    } catch {
      // A missing pin is not a deletion failure.
    }
    return { deleted: true, sessionId: targetSessionId };
  }

  /**
   * Read one Session snapshot without failing the whole deletion on a corrupt
   * log; the directory is still located for removal.
   * @param id - Session identity.
   * @param signal - cancellation.
   * @returns the snapshot, or undefined when absent or unreadable.
   */
  async stat(id, signal) {
    try {
      return await this.ctx.sessionPersistence.stat(id, { signal });
    } catch (error) {
      signal?.throwIfAborted();
      return undefined;
    }
  }

  /**
   * Locate the on-disk session directory: the persisted log's directory first,
   * then the cwd-derived path, then a scan of every project directory.
   * @param id - Session identity.
   * @param snapshot - current persistence snapshot, when readable.
   * @param root - configured session root.
   * @returns the directory path, or undefined when it cannot be derived.
   */
  async locate(id, snapshot, root) {
    if (typeof snapshot?.location?.path === "string") return dirname(snapshot.location.path);
    if (root === undefined) return undefined;
    const encoded = encodeSegment(id);
    const header = snapshot?.header;
    const cwd = typeof header?.cwd === "string" ? header.cwd : undefined;
    if (cwd !== undefined) {
      const direct = join(root, projectKey(cwd), encoded);
      if (await this.exists(direct)) return direct;
    }
    try {
      const projects = await fsp.readdir(root, { withFileTypes: true });
      for (const project of projects) {
        if (!project.isDirectory()) continue;
        const candidate = join(root, project.name, encoded);
        if (await this.exists(candidate)) return candidate;
      }
    } catch {
      // A missing root simply means there is nothing to scan.
    }
    if (header === undefined) return undefined;
    // The Session was created but never flushed; predict where the writer will land.
    return join(root, cwd === undefined ? "_no-cwd" : projectKey(cwd), encoded);
  }

  /** Whether a path exists. */
  async exists(path) {
    try {
      await fsp.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Move a session directory out of the session root. A sibling trash directory
   * is used so an open writer handle can keep appending while the row vanishes;
   * the move itself never exposes the deleted Session to listing again.
   * @param directory - session directory to move.
   * @param id - Session identity (for the trash name).
   * @param root - configured session root.
   * @returns the trash path, or undefined when the move is unavailable.
   */
  async moveAside(directory, id, root) {
    const trashRoot = await this.trashRoot(root);
    if (trashRoot === undefined) return undefined;
    const name = `${encodeSegment(id)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const target = join(trashRoot, name);
    try {
      await fsp.rename(directory, target);
      return target;
    } catch {
      return undefined;
    }
  }

  /**
   * Ensure a trash directory exists next to the session root, falling back to
   * the platform temp directory.
   * @param root - configured session root, when known.
   * @returns a writable trash directory, or undefined.
   */
  async trashRoot(root) {
    const candidates = [];
    if (root !== undefined) candidates.push(join(dirname(root), ".dsh-session-trash"));
    candidates.push(join(os.tmpdir(), "dsh-session-trash"));
    for (const candidate of candidates) {
      try {
        await fsp.mkdir(candidate, { recursive: true });
        return candidate;
      } catch {
        // Try the next location.
      }
    }
    return undefined;
  }

  /**
   * Retry removal in the background: a live writer may hold the file handle
   * open for a while after the row disappears from the Sidebar.
   * @param path - directory to remove.
   * @param delay - first attempt delay.
   */
  discardLater(path, delay = 200) {
    const timer = setTimeout(() => {
      void this.discard(path);
    }, delay);
    timer.unref?.();
  }

  /** Best-effort recursive removal with bounded backoff. */
  async discard(path) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await fsp.rm(path, { recursive: true, force: true });
        return;
      } catch {
        await sleep(250 * Math.min(attempt + 1, 4));
      }
    }
  }
}

// The decorator syntax is not available to a plain-JS bundle, so attach the
// same prototype descriptor `@Remote("delete")` would have produced.
Object.defineProperty(SessionDeleteService.prototype, REMOTE_METHODS, {
  configurable: true,
  value: {
    version: 1,
    methods: [{ method: "delete", invocation: { kind: "direct" } }],
  },
});

/**
 * Provide the deletion service on this plugin's fiber.
 * @param ctx - owning Host Context.
 */
export function apply(ctx) {
  ctx.provide(SERVICE_KEY, new SessionDeleteService(ctx));
}