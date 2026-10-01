/** Collapse a model's final text into one notification-friendly line. */
export function summarize(input: string, maxLength = 300): string {
  const flattened = input.replace(/\s+/g, " ").trim()
  if (flattened.length <= maxLength) return flattened
  return `${flattened.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

type Unknown = Record<string, unknown>

function isRecord(value: unknown): value is Unknown {
  return typeof value === "object" && value !== null
}

/** Walk a message's parts and return the last text block, ignoring tool output. */
export function lastText(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined
  const parts = message.parts ?? message.content
  if (!Array.isArray(parts)) return undefined
  let result: string | undefined
  for (const part of parts) {
    if (!isRecord(part)) continue
    if (part.type !== "text") continue
    if (typeof part.text !== "string") continue
    if (part.text.trim().length > 0) result = part.text
  }
  return result
}

/** Session context messages are tagged by `type`; model messages use `role`. */
function isAssistant(message: Unknown): boolean {
  return message.role === "assistant" || message.type === "assistant"
}

/** Newest assistant text in the session, or undefined when the model produced none. */
export function assistantText(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!isRecord(message)) continue
    const info = isRecord(message.info) ? message.info : undefined
    if (!isAssistant(message) && !(info && isAssistant(info))) continue
    const text = lastText(message) ?? (info ? lastText(info) : undefined)
    if (text) return text
  }
  return undefined
}