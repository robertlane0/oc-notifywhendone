import { describe, expect, test } from "bun:test"
import { assistantText, lastText, summarize } from "../src/summary"

describe("summarize", () => {
  test("collapses whitespace", () => {
    expect(summarize("line one\n\n  line two  ")).toBe("line one line two")
  })

  test("truncates with an ellipsis", () => {
    expect(summarize("abcdefghij", 5)).toBe("abcd…")
  })

  test("keeps short text intact", () => {
    expect(summarize("short", 300)).toBe("short")
  })

  test("truncation trims the trailing space before the ellipsis", () => {
    expect(summarize("aaaa bb cc", 8)).toBe("aaaa bb…")
    expect(summarize("aaaa bb cc", 6)).toBe("aaaa…")
  })
})

describe("lastText", () => {
  const message = {
    type: "assistant",
    content: [
      { type: "text", text: "first" },
      { type: "tool", id: "1", name: "read" },
      { type: "text", text: "second" },
    ],
  }

  test("returns the final non-empty text block", () => {
    expect(lastText(message)).toBe("second")
  })

  test("skips empty text blocks", () => {
    expect(lastText({ content: [{ type: "text", text: "   " }, { type: "text", text: "kept" }] })).toBe("kept")
  })

  test("accepts the `parts` field", () => {
    expect(lastText({ parts: [{ type: "text", text: "from parts" }] })).toBe("from parts")
  })

  test("returns undefined without text", () => {
    expect(lastText({ content: [{ type: "tool", id: "1" }] })).toBeUndefined()
    expect(lastText(undefined)).toBeUndefined()
    expect(lastText({})).toBeUndefined()
  })
})

describe("assistantText", () => {
  test("reads the newest assistant message", () => {
    const messages = [
      { type: "user", text: "hi" },
      { type: "assistant", content: [{ type: "text", text: "old answer" }] },
      { type: "user", text: "and again" },
      { type: "assistant", content: [{ type: "text", text: "new answer" }] },
    ]
    expect(assistantText(messages)).toBe("new answer")
  })

  test("skips trailing assistant messages with no text", () => {
    const messages = [
      { type: "assistant", content: [{ type: "text", text: "answer" }] },
      { type: "assistant", content: [{ type: "tool", id: "1", name: "read" }] },
    ]
    expect(assistantText(messages)).toBe("answer")
  })

  test("ignores user messages", () => {
    expect(assistantText([{ type: "user", text: "just a question" }])).toBeUndefined()
  })

  test("reads the wrapped info envelope", () => {
    const messages = [{ info: { role: "assistant" }, content: [{ type: "text", text: "wrapped" }] }]
    expect(assistantText(messages)).toBe("wrapped")
  })

  test("handles an empty transcript", () => {
    expect(assistantText([])).toBeUndefined()
  })
})