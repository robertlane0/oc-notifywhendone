import { describe, expect, test } from "bun:test"
import { buildNotification, projectName, sessionState } from "../src/index"
import { resolve } from "../src/options"

describe("sessionState", () => {
  test("reads busy and idle from session.status", () => {
    const busy = { type: "session.status", data: { sessionID: "ses_1", status: { type: "busy" } } }
    const idle = { type: "session.status", data: { sessionID: "ses_1", status: { type: "idle" } } }
    expect(sessionState(busy)).toEqual({ sessionID: "ses_1", state: "busy" })
    expect(sessionState(idle)).toEqual({ sessionID: "ses_1", state: "idle" })
  })

  test("accepts the deprecated session.idle event", () => {
    expect(sessionState({ type: "session.idle", data: { sessionID: "ses_1" } })).toEqual({
      sessionID: "ses_1",
      state: "idle",
    })
  })

  test("ignores retry status", () => {
    const retry = { type: "session.status", data: { sessionID: "ses_1", status: { type: "retry", attempt: 1 } } }
    expect(sessionState(retry)).toBeUndefined()
  })

  test("ignores unrelated and malformed events", () => {
    expect(sessionState({ type: "session.created", data: { sessionID: "ses_1" } })).toBeUndefined()
    expect(sessionState({ type: "session.status", data: {} })).toBeUndefined()
    expect(sessionState({ type: "session.status" })).toBeUndefined()
    expect(sessionState(null)).toBeUndefined()
  })
})

describe("projectName", () => {
  test("uses the last path segment", () => {
    expect(projectName("/home/me/code/demo")).toBe("demo")
  })

  test("ignores a trailing slash", () => {
    expect(projectName("/home/me/code/demo/")).toBe("demo")
  })

  test("falls back for a bare path", () => {
    expect(projectName("demo")).toBe("demo")
  })
})

describe("buildNotification", () => {
  const options = resolve({ topic: "alerts", title: "OpenCode" })
  const session = { location: { directory: "/home/me/code/demo" } }

  test("uses the model's final text", () => {
    const messages = [{ type: "assistant", content: [{ type: "text", text: "All tests pass." }] }]
    expect(buildNotification(options, session, messages)).toEqual({
      title: "OpenCode: demo",
      message: "All tests pass.",
    })
  })

  test("falls back when the model said nothing", () => {
    expect(buildNotification(options, session, [])).toEqual({
      title: "OpenCode: demo",
      message: "Finished responding",
    })
  })

  test("marks a failed run", () => {
    const failed = { ...session, outcome: "failed" }
    const messages = [{ type: "assistant", content: [{ type: "text", text: "rate limited" }] }]
    expect(buildNotification(options, failed, messages).message).toBe("Failed: rate limited")
  })

  test("truncates long responses", () => {
    const short = resolve({ topic: "alerts", title: "OpenCode", maxLength: 10 })
    const messages = [{ type: "assistant", content: [{ type: "text", text: "a very long answer indeed" }] }]
    expect(buildNotification(short, session, messages).message).toBe("a very lo…")
  })

  test("labels a session with no directory", () => {
    expect(buildNotification(options, {}, []).title).toBe("OpenCode: session")
  })
})