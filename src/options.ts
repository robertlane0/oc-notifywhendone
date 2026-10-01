export const PRIORITIES = ["min", "low", "default", "high", "urgent"] as const
export type Priority = (typeof PRIORITIES)[number]

export interface Options {
  server: string
  topic: string
  title: string
  priority: Priority
  tags: string
  token?: string
  enabled: boolean
  /** Maximum characters kept from the model's final text. */
  maxLength: number
}

export type RawOptions = Record<string, unknown>

export class OptionsError extends Error {}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function env(key: string): string | undefined {
  return text(process.env[key])
}

function normalizeServer(value: string): string {
  const trimmed = value.replace(/\/+$/, "")
  if (!/^https?:\/\//i.test(trimmed)) throw new OptionsError(`server must be an http(s) URL, got "${value}"`)
  return trimmed
}

/** Options win over environment variables; environment fills the gaps. */
export function resolve(raw: RawOptions = {}): Options {
  const enabled = raw.enabled === undefined ? true : raw.enabled !== false
  const priority = text(raw.priority) ?? "default"
  if (!PRIORITIES.includes(priority as Priority)) {
    throw new OptionsError(`priority must be one of ${PRIORITIES.join(", ")}, got "${priority}"`)
  }
  const maxLength = raw.maxLength === undefined ? 300 : Number(raw.maxLength)
  if (!Number.isFinite(maxLength) || maxLength <= 0) throw new OptionsError("maxLength must be a positive number")

  return {
    enabled,
    server: normalizeServer(text(raw.server) ?? env("NTFY_SERVER") ?? "https://ntfy.sh"),
    topic: text(raw.topic) ?? env("NTFY_TOPIC") ?? "",
    title: text(raw.title) ?? "OpenCode",
    priority: priority as Priority,
    tags: text(raw.tags) ?? env("NTFY_TAGS") ?? "",
    token: text(raw.token) ?? env("NTFY_TOKEN"),
    maxLength,
  }
}