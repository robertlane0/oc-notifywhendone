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

/** Busy and idle transitions arrive as `session.status`; older servers also emit `session.idle`. */
export function sessionState(event: unknown): { sessionID: string; state: "busy" | "idle" } | undefined {
  if (!isRecord(event)) return undefined
  const data = isRecord(event.data) ? event.data : undefined
  if (!data || typeof data.sessionID !== "string") return undefined
  if (event.type === "session.idle") return { sessionID: data.sessionID, state: "idle" }
  if (event.type !== "session.status") return undefined
  const status = isRecord(data.status) ? data.status : undefined
  const state = status?.type === "busy" ? "busy" : status?.type === "idle" ? "idle" : undefined
  return state ? { sessionID: data.sessionID, state } : undefined
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

export function buildNotification(options: Options, session: unknown, messages: readonly unknown[]) {
  const directory = sessionDirectory(session)
  const title = `${options.title}: ${directory ? projectName(directory) : "session"}`
  const text = assistantText(messages)
  const body = summarize(text ?? "Finished responding", options.maxLength)
  const failed = isRecord(session) && session.outcome === "failed"
  return { title, message: failed ? `Failed: ${body}` : body }
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

    // Only announce sessions seen working, so loading the plugin stays silent.
    const active = new Set<string>()
    const controller = new AbortController()

    const notify = async (sessionID: string) => {
      try {
        const session = await ctx.session.get({ sessionID })
        const messages = await ctx.session.context({ sessionID })
        const result = await deliver(options, buildNotification(options, session, messages))
        if (!result.ok) report("delivery failed", result.error)
      } catch (error) {
        report("notification skipped", error)
      }
    }

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const change = sessionState(event)
          if (!change) continue
          if (change.state === "busy") {
            active.add(change.sessionID)
            continue
          }
          if (!active.delete(change.sessionID)) continue
          await notify(change.sessionID)
        }
      } catch (error) {
        if (!controller.signal.aborted) report("event stream ended", error)
      }
    })()

    return () => {
      controller.abort()
      active.clear()
    }
  },
})