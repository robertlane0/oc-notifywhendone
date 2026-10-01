import { describe, expect, test } from "bun:test"
import { OptionsError, resolve } from "../src/options"

function clearEnv() {
  for (const key of ["NTFY_SERVER", "NTFY_TOPIC", "NTFY_TOKEN", "NTFY_TAGS"]) delete process.env[key]
}

describe("resolve", () => {
  test("defaults", () => {
    clearEnv()
    const options = resolve({ topic: "alerts" })
    expect(options.server).toBe("https://ntfy.sh")
    expect(options.topic).toBe("alerts")
    expect(options.title).toBe("OpenCode")
    expect(options.priority).toBe("default")
    expect(options.enabled).toBe(true)
    expect(options.maxLength).toBe(300)
  })

  test("options beat environment", () => {
    process.env.NTFY_TOPIC = "from-env"
    process.env.NTFY_SERVER = "https://env.example.com"
    try {
      const options = resolve({ topic: "explicit" })
      expect(options.topic).toBe("explicit")
      expect(options.server).toBe("https://env.example.com")
    } finally {
      clearEnv()
    }
  })

  test("environment supplies a missing topic", () => {
    clearEnv()
    process.env.NTFY_TOPIC = "env-only"
    try {
      expect(resolve().topic).toBe("env-only")
    } finally {
      clearEnv()
    }
  })

  test("trailing slashes are trimmed from the server", () => {
    clearEnv()
    expect(resolve({ server: "https://ntfy.example.com///" }).server).toBe("https://ntfy.example.com")
  })

  test("enabled accepts false and any other value", () => {
    expect(resolve({ enabled: false }).enabled).toBe(false)
    expect(resolve({ enabled: "no" }).enabled).toBe(true)
  })

  test("rejects a non-http server", () => {
    expect(() => resolve({ server: "ntfy.sh" })).toThrow(OptionsError)
  })

  test("rejects an unknown priority", () => {
    expect(() => resolve({ priority: "loud" })).toThrow(OptionsError)
  })

  test("rejects a non-positive maxLength", () => {
    expect(() => resolve({ maxLength: 0 })).toThrow(OptionsError)
    expect(() => resolve({ maxLength: "many" })).toThrow(OptionsError)
  })

  test("blank strings fall through to defaults", () => {
    clearEnv()
    expect(resolve({ topic: "  ", title: " " }).topic).toBe("")
    expect(resolve({ topic: "  ", title: " " }).title).toBe("OpenCode")
  })
})