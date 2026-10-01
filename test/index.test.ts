import { describe, expect, test } from "bun:test"
import { buildNotification, composeNotification, detectDone, projectName, textFragment } from "../src/index"
import { resolve } from "../src/options"

describe("textFragment", () => {
  test("reads a completed text block", () => {
    const event = {
      type: "session.text.ended",
      data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, text: "all done" },
    }
    expect(textFragment(event)).toEqual({ sessionID: "ses_1", messageID: "msg_1", text: "all done" })
  })

  test("ignores empty text and other event types", () => {
    expect(textFragment({ type: "session.text.ended", data: { sessionID: "s", assistantMessageID: "m", text: " " } }))
      .toBeUndefined()
    expect(textFragment({ type: "session.text.delta", data: { sessionID: "s", assistantMessageID: "m", text: "x" } }))
      .toBeUndefined()
    expect(textFragment({ type: "session.text.ended", data: { sessionID: "s", text: "x" } })).toBeUndefined()
    expect(textFragment(null)).toBeUndefined()
  })
})

describe("composeNotification", () => {
  const options = resolve({ topic: "alerts", title: "OpenCode" })

  test("uses the stream text and directory", () => {
    expect(composeNotification(options, "/home/me/code/demo", "All good.")).toEqual({
      title: "OpenCode: demo",
      message: "All good.",
    })
  })

  test("labels an unknown directory", () => {
    expect(composeNotification(options, undefined, "x").title).toBe("OpenCode: session")
  })

  test("marks a failure", () => {
    expect(composeNotification(options, "/a/b", "boom", true).message).toBe("Failed: boom")
  })
})

describe("detectDone", () => {
  test("a final step ends the response", () => {
    const done = detectDone({
      id: "evt_1",
      type: "session.step.ended",
      data: { sessionID: "ses_1", assistantMessageID: "msg_1", finish: "stop" },
    })
    expect(done).toEqual({ sessionID: "ses_1", key: "msg_1", failed: false })
  })

  test("a tool-calls step is not done", () => {
    const event = {
      type: "session.step.ended",
      data: { sessionID: "ses_1", assistantMessageID: "msg_1", finish: "tool-calls" },
    }
    expect(detectDone(event)).toBeUndefined()
  })

  test("an error finish marks the run failed", () => {
    const event = {
      type: "session.step.ended",
      data: { sessionID: "ses_1", assistantMessageID: "msg_1", finish: "error" },
    }
    expect(detectDone(event)).toEqual({ sessionID: "ses_1", key: "msg_1", failed: true })
  })

  test("a step without a message id is ignored", () => {
    const event = { type: "session.step.ended", data: { sessionID: "ses_1", finish: "stop" } }
    expect(detectDone(event)).toBeUndefined()
  })

  test("a failed execution notifies with a stable key", () => {
    const event = { id: "evt_9", type: "session.execution.failed", data: { sessionID: "ses_1" } }
    expect(detectDone(event)).toEqual({ sessionID: "ses_1", key: "failed:ses_1:evt_9", failed: true })
    expect(detectDone(event)).toEqual(detectDone(event))
  })

  test("a succeeded execution does not notify, steps already did", () => {
    const event = { id: "evt_2", type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
    expect(detectDone(event)).toBeUndefined()
  })

  test("an interrupted run does not notify", () => {
    const event = {
      id: "evt_3",
      type: "session.execution.interrupted",
      data: { sessionID: "ses_1", reason: "user" },
    }
    expect(detectDone(event)).toBeUndefined()
  })

  test("falls back to an idle status", () => {
    const event = {
      id: "evt_4",
      type: "session.status",
      data: { sessionID: "ses_1", status: { type: "idle" } },
    }
    expect(detectDone(event)).toEqual({ sessionID: "ses_1", key: "idle:ses_1:evt_4", failed: false })
  })

  test("a busy status does not notify", () => {
    const event = { type: "session.status", data: { sessionID: "ses_1", status: { type: "busy" } } }
    expect(detectDone(event)).toBeUndefined()
  })

  test("a retry status does not notify", () => {
    const event = {
      type: "session.status",
      data: { sessionID: "ses_1", status: { type: "retry", attempt: 1 } },
    }
    expect(detectDone(event)).toBeUndefined()
  })

  test("accepts the deprecated session.idle event", () => {
    const event = { id: "evt_5", type: "session.idle", data: { sessionID: "ses_1" } }
    expect(detectDone(event)).toEqual({ sessionID: "ses_1", key: "idle:ses_1:evt_5", failed: false })
  })

  test("ignores unrelated and malformed events", () => {
    expect(detectDone({ type: "session.created", data: { sessionID: "ses_1" } })).toBeUndefined()
    expect(detectDone({ type: "session.step.ended" })).toBeUndefined()
    expect(detectDone({ type: "session.step.ended", data: {} })).toBeUndefined()
    expect(detectDone(null)).toBeUndefined()
    expect(detectDone("session.step.ended")).toBeUndefined()
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
    const messages = [{ type: "assistant", content: [{ type: "text", text: "rate limited" }] }]
    expect(buildNotification(options, session, messages, true).message).toBe("Failed: rate limited")
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