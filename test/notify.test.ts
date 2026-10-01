import { describe, expect, test } from "bun:test"
import { authHeader, deliver, endpoint, headers } from "../src/notify"
import { resolve } from "../src/options"

describe("endpoint", () => {
  test("joins server and topic", () => {
    expect(endpoint("https://ntfy.sh", "my-topic")).toBe("https://ntfy.sh/my-topic")
  })

  test("encodes the topic", () => {
    expect(endpoint("https://ntfy.sh", "a b/c")).toBe("https://ntfy.sh/a%20b%2Fc")
  })
})

describe("authHeader", () => {
  test("bearer for a plain token", () => {
    expect(authHeader("tk_secret")).toBe("Bearer tk_secret")
  })

  test("basic for user:password", () => {
    expect(authHeader("phil:sesame")).toBe(`Basic ${Buffer.from("phil:sesame").toString("base64")}`)
  })
})

describe("headers", () => {
  const options = resolve({ topic: "alerts", priority: "high", tags: "robot" })

  test("always carries the title and text content type", () => {
    const result = headers(options, { title: "OpenCode: demo", message: "hi" })
    expect(result.Title).toBe("OpenCode: demo")
    expect(result["Content-Type"]).toContain("text/plain")
  })

  test("carries priority and tags from options", () => {
    const result = headers(options, { title: "t", message: "m" })
    expect(result.Priority).toBe("high")
    expect(result.Tags).toBe("robot")
  })

  test("omits absent optional fields", () => {
    const result = headers(resolve({ topic: "alerts" }), { title: "t", message: "m" })
    expect(result.Priority).toBeUndefined()
    expect(result.Tags).toBeUndefined()
    expect(result.Authorization).toBeUndefined()
  })

  test("includes the token when set", () => {
    const result = headers(resolve({ topic: "alerts", token: "tk_1" }), { title: "t", message: "m" })
    expect(result.Authorization).toBe("Bearer tk_1")
  })
})

describe("deliver", () => {
  const options = resolve({ topic: "alerts", server: "https://ntfy.test" })

  test("posts the message as plain text", async () => {
    let captured: { url: string; init: RequestInit } | undefined
    const fake = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch

    const result = await deliver(options, { title: "OpenCode: demo", message: "done" }, fake)
    expect(result.ok).toBe(true)
    expect(captured?.url).toBe("https://ntfy.test/alerts")
    expect(captured?.init.method).toBe("POST")
    expect(captured?.init.body).toBe("done")
  })

  test("reports a non-2xx response", async () => {
    const fake = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch
    const result = await deliver(options, { title: "t", message: "m" }, fake)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(result.error).toContain("403")
  })

  test("reports a network failure", async () => {
    const fake = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    const result = await deliver(options, { title: "t", message: "m" }, fake)
    expect(result.ok).toBe(false)
    expect(result.error).toBe("offline")
  })
})