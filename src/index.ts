import { Plugin } from "@opencode/plugin"
import { deliver } from "./notify"
import { OptionsError, resolve, type Options } from "./options"
import { assistantText, summarize } from "./summary"

type Unknown = Record<string, unknown>

function isRecord(value: unknown): value is Unknown {
  return typeof value === "object" && value !== null
}

function report(message: string, error?: unknown) {
  const detail = error === undefined ? "" : `: ${error instanceof Error ? error.message : String(error)}`
  console.error(`[oc-notifyondone] ${message}${detail}`)
}

/** Append-only diagnostics for delivery troubleshooting; opt-in via NTFY_DEBUG_FILE. */
async function trace(line: string) {
  const file = process.env.NTFY_DEBUG_FILE
  if (!file) return
  try {
    const handle = Bun.file(file)
    const existing = (await handle.exists()) ? await handle.text() : ""
    await Bun.write(file, existing + `${new Date().toISOString()} ${line}\n`)
  } catch {
    // Diagnostics must never interfere with delivery.
  }
}

/** Why the plugin should notify, plus a key that makes repeated events idempotent. */
export interface Done {
  sessionID: string
  /** Stable per finished response, so retries of the same event notify once. */
  key: string
  failed: boolean
}

/** `session.text.ended` carries the completed text block for one assistant message. */
export function textFragment(event: unknown): { sessionID: string; messageID: string; text: string } | undefined {
  const data = eventData(event)
  if (!data || (event as Unknown).type !== "session.text.ended") return undefined
  if (typeof data.sessionID !== "string" || typeof data.assistantMessageID !== "string") return undefined
  if (typeof data.text !== "string" || data.text.trim().length === 0) return undefined
  return { sessionID: data.sessionID, messageID: data.assistantMessageID, text: data.text }
}

function eventData(event: unknown): Unknown | undefined {
  if (!isRecord(event)) return undefined
  return isRecord(event.data) ? event.data : undefined
}

/**
 * `session.step.ended` on a final finish is where the model's response is complete.
 * A `tool-calls` finish is followed by more work, so it does not count as done.
 * `session.execution.failed` covers turns that never reach a final step; an interrupted run
 * is not a finished response and is ignored. `session.status` and the deprecated
 * `session.idle` are accepted as fallbacks for servers that do not emit step events.
 */
export function detectDone(event: unknown): Done | undefined {
  const data = eventData(event)
  if (!data || typeof data.sessionID !== "string") return undefined
  const sessionID = data.sessionID

  switch ((event as Unknown).type) {
    case "session.step.ended": {
      if (data.finish === "tool-calls") return undefined
      const messageID = typeof data.assistantMessageID === "string" ? data.assistantMessageID : ""
      if (!messageID) return undefined
      return { sessionID, key: messageID, failed: data.finish === "error" }
    }
    case "session.execution.failed":
      return { sessionID, key: `failed:${sessionID}:${(event as Unknown).id ?? ""}`, failed: true }
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return undefined
    case "session.status": {
      const status = isRecord(data.status) ? data.status : undefined
      if (status?.type !== "idle") return undefined
      return { sessionID, key: `idle:${sessionID}:${(event as Unknown).id ?? ""}`, failed: false }
    }
    case "session.idle": {
      const id = (event as Unknown).id
      return { sessionID, key: `idle:${sessionID}:${typeof id === "string" ? id : ""}`, failed: false }
    }
    default:
      return undefined
  }
}

/** Project directory name makes a better notification label than a full path. */
export function projectName(directory: string): string {
  const parts = directory.replace(/\/+$/, "").split("/").filter(Boolean)
  return parts[parts.length - 1] ?? directory
}

function sessionDirectory(session: unknown): string | undefined {
  if (!isRecord(session) || !isRecord(session.location)) return undefined
  return typeof session.location.directory === "string" ? session.location.directory : undefined
}

export function composeNotification(
  options: Options,
  directory: string | undefined,
  text: string | undefined,
  failed = false,
) {
  const title = `${options.title}: ${directory ? projectName(directory) : "session"}`
  const body = summarize(text ?? "Finished responding", options.maxLength)
  return { title, message: failed ? `Failed: ${body}` : body }
}

export function buildNotification(
  options: Options,
  session: unknown,
  messages: readonly unknown[],
  failed = false,
) {
  return composeNotification(options, sessionDirectory(session), assistantText(messages), failed)
}

export default Plugin.define({
  id: "oc-notifyondone",
  async setup(ctx) {
    let options: Options
    try {
      options = resolve(ctx.options)
    } catch (error) {
      report(error instanceof OptionsError ? error.message : "invalid options", error)
      return
    }
    if (!options.enabled) return
    if (!options.topic) {
      report("no topic configured; set the `topic` option or NTFY_TOPIC")
      return
    }

    const controller = new AbortController()
    // Dedupes repeat deliveries for one response; bounded so a long-lived server cannot grow it.
    const sent = new Set<string>()
    // Assistant text seen on the stream, so the common case needs no session read.
    const fragments = new Map<string, string>()
    // In-flight delivery, so a short-lived process can finish it during cleanup.
    let pending: Promise<unknown> | undefined

    const notify = async (done: Done, text?: string) => {
      sent.add(done.key)
      while (sent.size > 500) sent.delete(sent.values().next().value as string)
      fragments.delete(done.key)
      try {
        let notification
        if (text) {
          notification = composeNotification(options, ctx.location.directory, text, done.failed)
        } else {
          const session = await ctx.session.get({ sessionID: done.sessionID })
          const messages = await ctx.session.context({ sessionID: done.sessionID })
          notification = buildNotification(options, session, messages, done.failed)
        }
        await trace(`notify ${JSON.stringify(notification)}`)
        const result = await deliver(options, notification)
        await trace(`delivery ${JSON.stringify(result)}`)
        if (!result.ok) report("delivery failed", result.error)
      } catch (error) {
        await trace(`notify failed ${error instanceof Error ? error.message : String(error)}`)
        report("notification skipped", error)
      }
    }

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const fragment = textFragment(event)
          if (fragment) fragments.set(fragment.messageID, fragment.text)
          const done = detectDone(event)
          if (!done || sent.has(done.key)) continue
          pending = notify(done, fragments.get(done.key))
          await pending
          pending = undefined
        }
      } catch (error) {
        if (!controller.signal.aborted) report("event stream ended", error)
      }
    })()

    return async () => {
      controller.abort()
      sent.clear()
      // A one-shot run tears down as soon as the turn ends; let an in-flight POST finish.
      if (pending) await pending.catch(() => {})
    }
  },
})