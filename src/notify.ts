import type { Options } from "./options"

export interface Notification {
  title: string
  message: string
  tags?: string
  priority?: Options["priority"]
  click?: string
}

export interface Delivery {
  ok: boolean
  status?: number
  error?: string
}

/** ntfy accepts a bearer token for private topics and basic auth for username/password. */
export function authHeader(token: string): string {
  const [user, ...rest] = token.split(":")
  return rest.length > 0 && user.length > 0
    ? `Basic ${Buffer.from(`${user}:${rest.join(":")}`).toString("base64")}`
    : `Bearer ${token}`
}

export function endpoint(server: string, topic: string): string {
  return `${server.replace(/\/+$/, "")}/${encodeURIComponent(topic)}`
}

export function headers(options: Options, notification: Notification): Record<string, string> {
  const result: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    Title: notification.title,
  }
  const priority = notification.priority ?? options.priority
  // "default" is ntfy's own default; sending it adds nothing to the request.
  if (priority !== "default") result.Priority = priority
  const tags = notification.tags ?? options.tags
  if (tags) result.Tags = tags
  if (notification.click) result.Click = notification.click
  if (options.token) result.Authorization = authHeader(options.token)
  return result
}

export async function deliver(options: Options, notification: Notification, fetchImpl = fetch): Promise<Delivery> {
  try {
    const response = await fetchImpl(endpoint(options.server, options.topic), {
      method: "POST",
      headers: headers(options, notification),
      body: notification.message,
    })
    if (!response.ok) return { ok: false, status: response.status, error: `ntfy responded ${response.status}` }
    return { ok: true, status: response.status }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}