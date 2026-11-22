/**
 * Permanently delete one stored conversation, one slice of its turn history, or
 * every file that conversation owns inside the DSH data directory.
 *
 * The Host owns the operations (`SessionDeleteService`), the Client invokes them
 * through the Typert Gateway, and the Sidebar exposes them as context-menu
 * actions with confirmation dialogs.
 *
 * History editing never writes the storage format by hand: the log is read
 * through `sessionPersistence.open(id, 'read')`, the retained events are handed
 * back to `sessionPersistence.create(...)` + `handle.append(...)`, and the old
 * directory is parked in a trash folder until the rewrite has been read back
 * and verified. Event sequence numbers stay contiguous because the Session
 * store refuses anything else, so every seq-keyed reference is remapped here
 * (surface replacements, developer header cites, compaction shadow ranges).
 */
import { promises as fsp } from "node:fs";
import os from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";

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
/** Event types that may enter the model-visible surface. */
const SURFACE_TYPES = new Set([
  "system/message",
  "developer/message",
  "user/message",
  "assistant/message",
  "tool/result",
]);
/** Known log-only event types: they must never carry surface metadata. */
const LOG_TYPES = new Set([
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",
  "assistant/attempt",
  "tool/call",
  "request/header",
  "request/context",
  "session/end-seed",
  "compaction/start",
  "compaction/summary",
  "compaction/end",
  "compaction/prune",
]);
/** Prefix of a content-addressed attachment identity. */
const ATTACHMENT_PREFIX = "sha256:";
/** Longest prompt/answer preview handed to the Client. */
const PREVIEW_LIMIT = 96;

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

/** Human-readable text of one failure value. */
function reasonOf(error) {
  if (error instanceof Error && error.message !== "") return error.message;
  return String(error);
}

/** Whether a value is a non-negative safe integer. */
function isCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Concatenated text blocks of one message, trimmed. */
function textOf(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") out += block.text;
  }
  return out.trim();
}

/** Clip one preview to a readable length. */
function clip(text) {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > PREVIEW_LIMIT ? `${single.slice(0, PREVIEW_LIMIT)}…` : single;
}

/**
 * Group a log into turns. Events before the first `turn/start` belong to no
 * turn; they are never deleted by a segment operation.
 * @param events - the full validated log.
 * @returns turn spans, each a half-open [start, end) event index range.
 */
function turnSpans(events) {
  const spans = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.type !== "turn/start") continue;
    const turn = event.data?.turn;
    if (typeof turn !== "number") continue;
    spans.push({ turn, start: index, end: events.length });
    if (spans.length > 1) spans[spans.length - 2].end = index;
  }
  return spans;
}

/**
 * Every event sequence the surface fold has shadowed, so the Client can warn
 * about slices a replacement already covers.
 * @param events - the full validated log.
 * @returns the shadowed sequence numbers.
 */
function shadowedSeqs(events) {
  const shadowed = new Set();
  const nodes = [];
  for (const event of events) {
    const op = event?.surfaceOp;
    if (op === "append") {
      nodes.push(event.seq);
      continue;
    }
    if (op === null || typeof op !== "object" || op.op !== "replace") continue;
    const start = nodes.indexOf(op.startSeq);
    const end = nodes.indexOf(op.endSeq);
    if (start < 0 || end < 0 || start > end) continue;
    for (const seq of nodes.slice(start, end + 1)) shadowed.add(seq);
    nodes.splice(start, end - start + 1, event.seq);
  }
  return shadowed;
}

/**
 * Validate one rewritten log exactly like the Session store does on restore:
 * contiguous sequence numbers, surface eligibility, replacement membership,
 * source-event citations, developer header cites, and compaction shadow
 * ranges. Any violation is a caller bug here, never a user problem.
 * @param events - the candidate log.
 * @throws RemoteFailure when the log would not restore.
 */
function validateChain(events) {
  const nodes = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === null || typeof event !== "object") {
      throw new RemoteFailure("session-delete/corrupt", `event ${index} is not an object`);
    }
    if (event.seq !== index) {
      throw new RemoteFailure("session-delete/corrupt", `event seq ${event.seq} is not contiguous; expected ${index}`);
    }
    const type = event.type;
    const op = event.surfaceOp;
    if (SURFACE_TYPES.has(type)) {
      if (op === undefined) {
        throw new RemoteFailure("session-delete/corrupt", `surface event "${type}" lost its surfaceOp`);
      }
      if (op === "append") {
        nodes.push(event.seq);
      } else if (op !== null && typeof op === "object" && op.op === "replace") {
        if (!isCount(op.startSeq) || !isCount(op.endSeq) || op.startSeq >= event.seq || op.endSeq >= event.seq) {
          throw new RemoteFailure("session-delete/corrupt", `surface replace at ${event.seq} cites a later event`);
        }
        const start = nodes.indexOf(op.startSeq);
        const end = nodes.indexOf(op.endSeq);
        if (start < 0 || end < 0 || start > end) {
          throw new RemoteFailure(
            "session-delete/corrupt",
            `surface replace at ${event.seq} no longer covers a current surface range`,
          );
        }
        const shadowed = nodes.slice(start, end + 1);
        const sources = event.sourceEventSeqs;
        if (type === "assistant/message" && sources !== undefined) {
          throw new RemoteFailure("session-delete/corrupt", "assistant/message cannot cite source events");
        }
        if (sources !== undefined) {
          if (!Array.isArray(sources) || sources.length === 0) {
            throw new RemoteFailure("session-delete/corrupt", `event ${event.seq} cites an empty source list`);
          }
          const seen = new Set();
          for (const source of sources) {
            if (!isCount(source) || source >= event.seq) {
              throw new RemoteFailure("session-delete/corrupt", `event ${event.seq} cites a later source`);
            }
            if (seen.has(source)) {
              throw new RemoteFailure("session-delete/corrupt", `event ${event.seq} repeats a source`);
            }
            seen.add(source);
          }
          for (const seq of shadowed) {
            if (!seen.has(seq)) {
              throw new RemoteFailure(
                "session-delete/corrupt",
                `surface replace at ${event.seq} no longer cites shadowed event ${seq}`,
              );
            }
          }
        } else if (shadowed.length > 0) {
          throw new RemoteFailure("session-delete/corrupt", `surface replace at ${event.seq} cites no source events`);
        }
        nodes.splice(start, end - start + 1, event.seq);
      } else {
        throw new RemoteFailure("session-delete/corrupt", `surface event "${type}" has an invalid surfaceOp`);
      }
      continue;
    }
    if (LOG_TYPES.has(type)) {
      if (op !== undefined || event.sourceEventSeqs !== undefined) {
        throw new RemoteFailure("session-delete/corrupt", `log-only event "${type}" carries surface metadata`);
      }
    }
    if (type === "developer/message" && event.data?.headerSeq !== undefined) {
      const headerSeq = event.data.headerSeq;
      if (!isCount(headerSeq) || headerSeq >= event.seq || events[headerSeq]?.type !== "request/header") {
        throw new RemoteFailure(
          "session-delete/conflict",
          "a developer message cites a request header inside the removed slice",
        );
      }
    }
    if (type === "compaction/prune" || type === "compaction/summary") {
      const data = event.data;
      const range = data?.shadowedRange;
      if (range !== undefined) {
        for (const seq of [range.start, range.end]) {
          if (!isCount(seq) || seq >= event.seq) {
            throw new RemoteFailure("session-delete/conflict", "a compaction record cites a removed event");
          }
        }
      }
      if (Array.isArray(data?.shadowedSeqs)) {
        for (const seq of data.shadowedSeqs) {
          if (!isCount(seq) || seq >= event.seq) {
            throw new RemoteFailure("session-delete/conflict", "a compaction record cites a removed event");
          }
        }
      }
    }
  }
  return events.length;
}

/**
 * Rewrite every seq reference of one retained suffix event after a cut.
 * @param event - the original event (its own seq is replaced by the caller).
 * @param start - first removed sequence number.
 * @param end - one past the last removed sequence number.
 * @param shift - how many events the cut removed.
 * @returns the event with remapped references.
 * @throws RemoteFailure when a reference points into the removed slice.
 */
function remapReferences(event, start, end, shift) {
  const map = (seq) => {
    if (!isCount(seq)) return seq;
    if (seq >= end) return seq - shift;
    if (seq >= start) {
      throw new RemoteFailure(
        "session-delete/conflict",
        "this slice is covered by a summary or a tool rewrite and cannot be removed safely",
      );
    }
    return seq;
  };
  let next = event;
  const mutate = () => {
    if (next === event) next = { ...event };
    return next;
  };
  if (Array.isArray(event.sourceEventSeqs)) {
    mutate().sourceEventSeqs = event.sourceEventSeqs.map(map);
  }
  const op = event.surfaceOp;
  if (op !== null && typeof op === "object" && op.op === "replace") {
    mutate().surfaceOp = { op: "replace", startSeq: map(op.startSeq), endSeq: map(op.endSeq) };
  }
  if (event.type === "developer/message" && event.data?.headerSeq !== undefined) {
    mutate().data = { ...event.data, headerSeq: map(event.data.headerSeq) };
  }
  if (event.type === "compaction/prune" || event.type === "compaction/summary") {
    const data = event.data;
    if (data?.shadowedRange !== undefined || Array.isArray(data?.shadowedSeqs)) {
      const patched = { ...data };
      if (data.shadowedRange !== undefined) {
        patched.shadowedRange = { start: map(data.shadowedRange.start), end: map(data.shadowedRange.end) };
      }
      if (Array.isArray(data.shadowedSeqs)) patched.shadowedSeqs = data.shadowedSeqs.map(map);
      mutate().data = patched;
    }
  }
  return next;
}

/** Every content-addressed attachment identity referenced by a log. */
function attachmentIdsOf(events) {
  const ids = new Set();
  for (const event of events) {
    let json;
    try {
      json = JSON.stringify(event.data);
    } catch {
      continue;
    }
    if (json === undefined || !json.includes(ATTACHMENT_PREFIX)) continue;
    const pattern = /sha256:([a-f0-9]{64})/g;
    let match;
    while ((match = pattern.exec(json)) !== null) ids.add(match[1]);
  }
  return ids;
}

/**
 * Build the event list left after removing one slice of turns, remapping every
 * seq-keyed reference that survives the cut.
 *
 * The slice is expressed the way the Client picked it: `fromTurn` alone removes
 * that turn and everything after it (a cut to the end), while `fromTurn` plus
 * `toTurn` removes just that block and keeps the later turns.
 * @param events - the full log, as read from storage.
 * @param selection - `fromTurn`, and optionally `toTurn`.
 * @param inheritedEventCount - length of the prefix that belongs to a fork parent.
 * @returns the retained events, already validated.
 */
function buildEdited(events, selection, inheritedEventCount) {
  const inherited = typeof inheritedEventCount === "number" ? inheritedEventCount : 0;
  const spans = turnSpans(events);
  const first = spans.find((item) => item.turn === selection.fromTurn);
  if (first === undefined) {
    throw new RemoteFailure("session-delete/range", "That turn does not exist in this conversation.");
  }
  if (first.start < inherited) {
    throw new RemoteFailure("session-delete/range", "Inherited history cannot be removed.");
  }
  if (selection.toTurn === undefined || selection.toTurn === null) {
    if (first.start === 0) {
      throw new RemoteFailure("session-delete/range", "At least the first turn must be kept.");
    }
    const kept = events.slice(0, first.start);
    if (kept.length === 0) {
      throw new RemoteFailure("session-delete/range", "At least the first turn must be kept.");
    }
    validateChain(kept);
    return kept;
  }
  const last = spans.find((item) => item.turn === selection.toTurn);
  if (last === undefined) {
    throw new RemoteFailure("session-delete/range", "That turn range does not exist in this conversation.");
  }
  if (last.end <= first.start) {
    throw new RemoteFailure("session-delete/range", "That turn range does not exist in this conversation.");
  }
  const start = first.start;
  const end = last.end;
  const head = events.slice(0, start);
  const tail = events.slice(end);
  if (head.length === 0 && tail.length === 0) {
    throw new RemoteFailure("session-delete/range", "Deleting every turn is not a slice edit.");
  }
  const shift = end - start;
  const kept = head.concat(tail.map((event, offset) => {
    const remapped = remapReferences(event, start, end, shift);
    return { ...remapped, seq: start + offset };
  }));
  validateChain(kept);
  return kept;
}

/**
 * Host service exposing the destructive conversation actions. Registered as the
 * Typert namespace `sessionDelete`, so the Client reaches each method at
 * `/api/sessionDelete/<method>` through the Connection RPC.
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
   * Delete one stored Session outright: stop its work, detach its live entry,
   * move its log directory out of the session root, and announce the removal so
   * every open sidebar drops the row.
   * @param targetSessionId - Session identity to delete.
   * @param signal - cancellation from the Remote call.
   * @returns the deletion receipt.
   */
  async delete(targetSessionId, signal) {
    const id = this.requireId(targetSessionId);
    const { sessionRoot } = this.roots();
    const snapshot = await this.stat(id, signal);
    const entry = this.ctx.sessions?.store?.get?.(id);
    if (snapshot === undefined && entry === undefined) {
      throw new RemoteFailure("session-delete/not-found", "This conversation no longer exists.");
    }
    this.assertIdle(entry);
    const announced = await this.settle(id, entry, signal);
    signal?.throwIfAborted();
    const directory = await this.locate(id, snapshot, sessionRoot);
    if (directory === undefined) {
      throw new RemoteFailure("session-delete/io-failed", "The conversation files could not be located.");
    }
    await this.removeLog(id, directory, sessionRoot);
    if (!announced) this.ctx.emit("api-session/removed", id);
    try {
      await this.ctx.get("workspaceRegistry")?.unpinSession?.(id);
    } catch {
      // A missing pin is not a deletion failure.
    }
    return { deleted: true, sessionId: id };
  }

  /**
   * List the turns of one stored conversation so the Client can offer an exact
   * slice to remove.
   * @param targetSessionId - Session identity.
   * @param signal - cancellation.
   * @returns the turn outline.
   */
  async outlines(targetSessionId, signal) {
    const id = this.requireId(targetSessionId);
    const read = await this.readSession(id, signal);
    if (read === undefined) {
      throw new RemoteFailure("session-delete/not-found", "This conversation no longer exists.");
    }
    const shadowed = shadowedSeqs(read.events);
    const spans = turnSpans(read.events);
    const turns = spans.map((span) => {
      let prompt = "";
      let answer = "";
      let compacted = false;
      let messageId = null;
      for (let index = span.start; index < span.end; index += 1) {
        const event = read.events[index];
        if (shadowed.has(event.seq)) compacted = true;
        if (event.type === "user/message" && prompt === "") prompt = clip(textOf(event.data?.message));
        if (event.type === "assistant/message") {
          const text = textOf(event.data?.message);
          if (text !== "") answer = clip(text);
          if (typeof event.data?.message?.id === "string") messageId = event.data.message.id;
        }
      }
      return {
        turn: span.turn,
        startSeq: span.start,
        endSeq: span.end,
        events: span.end - span.start,
        prompt,
        answer,
        compacted,
        messageId,
      };
    });
    return {
      sessionId: id,
      eventCount: read.events.length,
      inheritedEventCount: read.inheritedEventCount,
      turns,
    };
  }

  /**
   * Remove one turn and everything after it, keeping the earlier conversation.
   * @param targetSessionId - Session identity.
   * @param cutTurn - first removed turn number (inclusive).
   * @param signal - cancellation.
   * @returns the rewrite receipt.
   */
  async truncate(targetSessionId, cutTurn, signal) {
    const id = this.requireId(targetSessionId);
    if (!isCount(cutTurn) || cutTurn < 1) {
      throw new RemoteFailure("session-delete/range", "A turn number is required.");
    }
    const read = await this.requireRead(id, signal);
    await this.releaseForRewrite(id, signal);
    const kept = buildEdited(read.events, { fromTurn: cutTurn }, read.inheritedEventCount);
    return this.rewriteSession(id, read, kept, signal, cutTurn);
  }

  /**
   * Remove one contiguous block of turns from the middle of a conversation,
   * keeping the turns before and after it.
   * @param targetSessionId - Session identity.
   * @param fromTurn - first removed turn number (inclusive).
   * @param toTurn - last removed turn number (inclusive).
   * @param signal - cancellation.
   * @returns the rewrite receipt.
   */
  async removeRange(targetSessionId, fromTurn, toTurn, signal) {
    const id = this.requireId(targetSessionId);
    if (!isCount(fromTurn) || !isCount(toTurn) || fromTurn < 1 || toTurn < fromTurn) {
      throw new RemoteFailure("session-delete/range", "A valid turn range is required.");
    }
    const read = await this.requireRead(id, signal);
    await this.releaseForRewrite(id, signal);
    const kept = buildEdited(
      read.events,
      { fromTurn, toTurn },
      read.inheritedEventCount,
    );
    return this.rewriteSession(id, read, kept, signal, fromTurn);
  }

  /**
   * Describe every file this conversation owns inside the DSH data directory,
   * without touching any of them.
   * @param targetSessionId - Session identity.
   * @param signal - cancellation.
   * @returns the artifact inventory.
   */
  async artifacts(targetSessionId, signal) {
    const id = this.requireId(targetSessionId);
    const plan = await this.gatherArtifacts(id, signal);
    return {
      sessionId: id,
      log: plan.log === undefined ? null : { path: plan.log.directory, bytes: plan.log.bytes },
      cache: plan.cache,
      trash: plan.trash.map((entry) => ({ name: entry.name, bytes: entry.bytes })),
      attachments: plan.attachments.map((entry) => ({ id: entry.id, bytes: entry.bytes })),
      totalBytes: plan.totalBytes,
    };
  }

  /**
   * Delete the conversation and every artifact it owns: its log, its projection
   * cache row, its trash residue, and the attachment objects only it references.
   * Workspace files produced by the Agent are never touched.
   * @param targetSessionId - Session identity.
   * @param signal - cancellation.
   * @returns the purge receipt.
   */
  async purge(targetSessionId, signal) {
    const id = this.requireId(targetSessionId);
    const { sessionRoot } = this.roots();
    const snapshot = await this.stat(id, signal);
    const entry = this.ctx.sessions?.store?.get?.(id);
    if (snapshot === undefined && entry === undefined) {
      throw new RemoteFailure("session-delete/not-found", "This conversation no longer exists.");
    }
    this.assertIdle(entry);
    const plan = await this.gatherArtifacts(id, signal, snapshot);
    signal?.throwIfAborted();
    const announced = await this.settle(id, entry, signal);
    signal?.throwIfAborted();
    const cacheDropped = await this.dropProjectionCache(id);
    let attachmentBytes = 0;
    for (const attachment of plan.attachments) {
      for (const path of attachment.paths) {
        try {
          await fsp.rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
        } catch {
          // A missing or locked object is not a reason to abort the whole purge.
        }
      }
      attachmentBytes += attachment.bytes;
    }
    let trashEntries = 0;
    for (const residue of plan.trash) {
      try {
        await fsp.rm(residue.path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
        trashEntries += 1;
      } catch {
        // Leftovers can be retried by a later purge.
      }
    }
    if (plan.log !== undefined) {
      await this.removeLog(id, plan.log.directory, sessionRoot);
    } else {
      const directory = await this.locate(id, snapshot, sessionRoot);
      if (directory !== undefined && (await this.exists(directory))) {
        await this.removeLog(id, directory, sessionRoot);
      }
    }
    if (!announced) this.ctx.emit("api-session/removed", id);
    try {
      await this.ctx.get("workspaceRegistry")?.unpinSession?.(id);
    } catch {
      // A missing pin is not a purge failure.
    }
    return {
      purged: true,
      sessionId: id,
      bytes: plan.totalBytes,
      attachments: plan.attachments.length,
      attachmentBytes,
      trash: trashEntries,
      cache: cacheDropped,
    };
  }

  // --- internals -----------------------------------------------------------

  /** Reject a non-identity argument. */
  requireId(value) {
    if (typeof value !== "string" || value.length === 0) {
      throw new RemoteFailure("session-delete/invalid", "A conversation id is required.");
    }
    return value;
  }

  /** Reject a conversation that is still being written. */
  assertIdle(entry) {
    if (entry !== undefined && (entry.appending === true || entry.announcement === "dispatching")) {
      throw new RemoteFailure("session-delete/busy", "This conversation is still being written; try again in a moment.");
    }
  }

  /**
   * Free the log for a rewrite. A Session still cached from an earlier visit is
   * detached once it is idle, so its writer releases the file; a Session that is
   * actively appending stays refused.
   */
  async releaseForRewrite(id, signal) {
    const entry = this.ctx.sessions?.store?.get?.(id);
    if (entry === undefined) return;
    this.assertIdle(entry);
    await this.settle(id, entry, signal);
  }

  /**
   * Stop the Agent, detach the live store entry, and let the writer settle.
   * @returns whether the removal still needs to be announced.
   */
  async settle(id, entry, signal) {
    const agent = this.ctx.agents?.get?.(id);
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
    if (agent !== undefined) await sleep(160);
    signal?.throwIfAborted();
    return announced;
  }

  /** All data-directory roots this service needs. */
  roots() {
    const persistence = this.ctx.sessionPersistence;
    const sessionRoot = typeof persistence?.root === "string" ? resolve(persistence.root) : undefined;
    let home;
    if (typeof process?.env?.DSH_HOME === "string" && process.env.DSH_HOME !== "") {
      home = resolve(process.env.DSH_HOME);
    } else if (sessionRoot !== undefined) {
      home = dirname(sessionRoot);
    }
    return {
      sessionRoot,
      attachmentsRoot: home === undefined ? undefined : join(home, "attachments", "v1"),
    };
  }

  /** Read one Session's whole log, or undefined when it is gone. */
  async readSession(id, signal) {
    let handle;
    try {
      handle = await this.ctx.sessionPersistence.open(id, "read", { signal });
    } catch (error) {
      signal?.throwIfAborted();
      return undefined;
    }
    try {
      const result = await handle.read(0, undefined, { signal });
      return { header: handle.header, inheritedEventCount: handle.inheritedEventCount, events: result.events };
    } catch (error) {
      signal?.throwIfAborted();
      throw new RemoteFailure("session-delete/io-failed", `Could not read the conversation: ${reasonOf(error)}`);
    } finally {
      try {
        await handle.close();
      } catch {
        // Closing a read handle cannot lose data.
      }
    }
  }

  /** Read one Session or fail with the stable not-found code. */
  async requireRead(id, signal) {
    const read = await this.readSession(id, signal);
    if (read === undefined) {
      throw new RemoteFailure("session-delete/not-found", "This conversation no longer exists.");
    }
    return read;
  }

  /**
   * Replace one stored log with an edited event list, keeping the previous
   * directory in the trash until the rewrite has been read back and verified.
   * @param id - Session identity.
   * @param read - the original header, inherited cut, and events.
   * @param events - the edited, validated event list.
   * @param signal - cancellation.
   * @param changedTurn - first affected turn, for the receipt.
   * @returns the rewrite receipt.
   */
  async rewriteSession(id, read, events, signal, changedTurn) {
    const persistence = this.ctx.sessionPersistence;
    const { sessionRoot } = this.roots();
    const snapshot = await this.stat(id, signal);
    const directory = await this.locate(id, snapshot, sessionRoot);
    if (directory === undefined) {
      throw new RemoteFailure("session-delete/io-failed", "The conversation files could not be located.");
    }
    let moved;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      signal?.throwIfAborted();
      if (attempt > 0) await sleep(120 + Math.min(attempt, 8) * 60);
      if (!(await this.exists(directory))) break;
      moved = await this.moveAside(directory, id, sessionRoot);
      if (moved !== undefined) break;
    }
    if (moved === undefined && (await this.exists(directory))) {
      throw new RemoteFailure(
        "session-delete/busy",
        "The conversation files are still in use; close the conversation and try again.",
      );
    }
    let handle;
    try {
      handle = await persistence.create(read.header, {
        signal,
        inheritedEventCount: read.inheritedEventCount,
      });
      if (events.length > 0) await handle.append(events, { signal });
      await handle.flush({ signal });
      await handle.close();
      handle = undefined;
    } catch (error) {
      try {
        await handle?.close();
      } catch {
        // Best-effort teardown of a half-written handle.
      }
      await this.removeLogQuietly(id, read.header, sessionRoot);
      if (moved !== undefined) {
        try {
          await fsp.rename(moved, directory);
          moved = undefined;
        } catch {
          // Restoring is best effort; the trash copy still exists.
        }
      }
      throw new RemoteFailure("session-delete/io-failed", `Could not write the conversation: ${reasonOf(error)}`);
    }
    const check = await this.readSession(id, undefined);
    if (check === undefined || check.events.length !== events.length) {
      await this.removeLogQuietly(id, read.header, sessionRoot);
      if (moved !== undefined) {
        try {
          await fsp.rename(moved, directory);
          moved = undefined;
        } catch {
          // The trash copy remains recoverable by hand.
        }
      }
      throw new RemoteFailure("session-delete/io-failed", "The rewritten conversation did not read back correctly.");
    }
    await this.dropProjectionCache(id);
    if (moved !== undefined) this.discardLater(moved, 4000);
    return {
      truncated: true,
      sessionId: id,
      removedEvents: read.events.length - events.length,
      eventCount: events.length,
      fromTurn: changedTurn,
    };
  }

  /** Best-effort projection-cache row removal; the cache is derived data. */
  async dropProjectionCache(id) {
    try {
      const facility = this.ctx.get?.("storageDomain");
      const domain = facility?.get?.("session_projcache");
      if (domain === undefined) return false;
      const table = domain.table("sessions");
      if (table.get(id) === undefined) return false;
      await table.delete(id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Collect everything a conversation owns in the data directory.
   * @param id - Session identity.
   * @param signal - cancellation.
   * @param known - an already-read snapshot, when the caller has one.
   * @returns the artifact plan.
   */
  async gatherArtifacts(id, signal, known) {
    const snapshot = known ?? (await this.stat(id, signal));
    const { sessionRoot, attachmentsRoot } = this.roots();
    const read = await this.readSession(id, signal);
    if (snapshot === undefined && read === undefined) {
      throw new RemoteFailure("session-delete/not-found", "This conversation no longer exists.");
    }
    let log;
    const directory = await this.locate(id, snapshot ?? { header: read?.header }, sessionRoot);
    if (directory !== undefined && (await this.exists(directory))) {
      log = { directory, bytes: await this.sizeOf(directory) };
    }
    let cache = false;
    try {
      const facility = this.ctx.get?.("storageDomain");
      cache = facility?.get?.("session_projcache")?.table?.("sessions")?.get?.(id) !== undefined;
    } catch {
      cache = false;
    }
    const trash = await this.trashResidue(id, sessionRoot);
    const attachments = attachmentsRoot === undefined || read === undefined
      ? []
      : await this.orphanAttachments(attachmentsRoot, attachmentIdsOf(read.events), id, signal);
    let totalBytes = log?.bytes ?? 0;
    for (const entry of trash) totalBytes += entry.bytes;
    for (const entry of attachments) totalBytes += entry.bytes;
    return { log, cache, trash, attachments, totalBytes };
  }

  /**
   * Resolve which attachment objects are referenced only by this conversation.
   * A digest still cited by any other stored conversation is kept.
   * @param root - `DSH_HOME/attachments/v1`.
   * @param ids - digests referenced by the target conversation.
   * @param exclude - the target conversation id.
   * @param signal - cancellation.
   * @returns the deletable objects with their sizes.
   */
  async orphanAttachments(root, ids, exclude, signal) {
    if (ids.size === 0) return [];
    const shared = new Set();
    let snapshots = [];
    try {
      snapshots = await this.ctx.sessionPersistence.list({ signal });
    } catch {
      // Without a listing nothing can be proven exclusive: keep every object.
      return [];
    }
    for (const snapshot of snapshots) {
      signal?.throwIfAborted();
      const other = snapshot?.header?.id;
      if (typeof other !== "string" || other === exclude) continue;
      const read = await this.readSession(other, signal);
      if (read === undefined) continue;
      for (const digest of attachmentIdsOf(read.events)) {
        if (ids.has(digest)) shared.add(digest);
      }
      if (shared.size === ids.size) break;
    }
    const orphans = [];
    for (const digest of ids) {
      if (shared.has(digest)) continue;
      const prefix = digest.slice(0, 2);
      const candidates = [
        join(root, "objects", prefix, digest),
        join(root, "file-objects", prefix, digest),
        join(root, "files", prefix, digest),
      ];
      const present = [];
      let bytes = 0;
      for (const path of candidates) {
        if (!(await this.exists(path))) continue;
        present.push(path);
        bytes += await this.sizeOf(path);
      }
      if (present.length === 0) continue;
      orphans.push({ id: `${ATTACHMENT_PREFIX}${digest}`, paths: present, bytes });
    }
    return orphans;
  }

  /** Trash entries this conversation left behind. */
  async trashResidue(id, sessionRoot) {
    const roots = [];
    if (sessionRoot !== undefined) roots.push(join(dirname(sessionRoot), ".dsh-session-trash"));
    roots.push(join(os.tmpdir(), "dsh-session-trash"));
    const prefix = `${encodeSegment(id)}-`;
    const found = [];
    for (const root of roots) {
      let entries;
      try {
        entries = await fsp.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.name.startsWith(prefix)) continue;
        const path = join(root, entry.name);
        found.push({ name: entry.name, path, bytes: await this.sizeOf(path) });
      }
    }
    return found;
  }

  /** Recursive byte size of a file or directory tree. */
  async sizeOf(path) {
    let total = 0;
    const walk = async (current) => {
      let info;
      try {
        info = await fsp.stat(current);
      } catch {
        return;
      }
      if (info.isFile()) {
        total += info.size;
        return;
      }
      if (!info.isDirectory()) return;
      let entries;
      try {
        entries = await fsp.readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        await walk(join(current, entry.name));
      }
    };
    await walk(path);
    return total;
  }

  /** Move one session directory out of the session root, or remove it. */
  async removeLog(id, directory, sessionRoot) {
    if (await this.exists(directory)) {
      const moved = await this.moveAside(directory, id, sessionRoot);
      if (moved !== undefined) {
        this.discardLater(moved);
        return;
      }
      try {
        await fsp.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
        return;
      } catch (error) {
        throw new RemoteFailure(
          "session-delete/io-failed",
          `Could not remove the conversation files: ${reasonOf(error)}`,
        );
      }
    }
    // A created-but-unflushed Session may still flush during teardown.
    this.discardLater(directory, 2500);
  }

  /** Remove a possibly half-written log without raising. */
  async removeLogQuietly(id, header, sessionRoot) {
    let directory;
    try {
      directory = await this.locate(id, { header }, sessionRoot);
    } catch {
      return;
    }
    if (directory === undefined) return;
    try {
      await fsp.rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    } catch {
      // A leftover is recoverable and does not hide the original failure.
    }
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
// same prototype descriptor `@Remote(...)` would have produced.
Object.defineProperty(SessionDeleteService.prototype, REMOTE_METHODS, {
  configurable: true,
  value: {
    version: 1,
    methods: [
      { method: "delete", invocation: { kind: "direct" } },
      { method: "outlines", invocation: { kind: "direct" } },
      { method: "truncate", invocation: { kind: "direct" } },
      { method: "removeRange", invocation: { kind: "direct" } },
      { method: "artifacts", invocation: { kind: "direct" } },
      { method: "purge", invocation: { kind: "direct" } },
    ],
  },
});

/**
 * Provide the deletion service on this plugin's fiber.
 * @param ctx - owning Host Context.
 */
export function apply(ctx) {
  ctx.provide(SERVICE_KEY, new SessionDeleteService(ctx));
}