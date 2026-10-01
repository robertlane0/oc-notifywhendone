# oc-notifyondone

An OpenCode plugin that sends an [ntfy](https://ntfy.sh) message when a model finishes responding.

## Goal

Deliver a notification through ntfy whenever an OpenCode session goes idle after a
model turn completes, so long-running work can be monitored from a phone.

## Approach

### Event source

Subscribe to the public server event stream with `ctx.event.subscribe()` and wait
for the session to become idle:

- `session.status` with `status.type === "idle"` is the current signal.
- `session.idle` is the deprecated equivalent and is accepted as a fallback.

The plugin only tracks sessions it has seen become busy first, so plugin load
does not produce a notification for work that predates it.

### Message content

For each idle transition, read the session through `ctx.session.get()` and
`ctx.session.context()`, then build a short summary:

- Title: `OpenCode: <project name>` by default, overridable per plugin option.
- Body: last assistant text block, collapsed to a single line and length-capped.

### Transport

A single `fetch` POST to `<server>/<topic>` with `Content-Type: text/plain`, plus
optional `Title`, `Priority`, `Tags`, `Click`, and `Authorization` headers when
configured. No ntfy SDK dependency is required.

## Configuration

Plugin options, all optional:

| Option    | Default          | Meaning                                    |
| --------- | ---------------- | ------------------------------------------ |
| `server`  | `https://ntfy.sh`| ntfy base URL, self-hosted allowed         |
| `topic`   | none             | Required. Topic name on the server         |
| `title`   | `OpenCode`       | Notification title prefix                  |
| `priority`| `default`        | ntfy priority: `min`, `low`, `default`, `high`, `urgent` |
| `tags`    | none             | Comma-separated ntfy tags/emoji            |
| `token`   | none             | Access token for private topics            |
| `enabled` | `true`           | Set `false` to disable delivery            |

Environment variables are read as fallbacks so the plugin also works when
installed without config edits: `NTFY_TOPIC`, `NTFY_SERVER`, `NTFY_TOKEN`.

## Layout

```
package.json      plugin manifest, `@opencode/plugin` dependency
src/index.ts      plugin entrypoint and event loop
src/notify.ts     ntfy delivery
src/options.ts    option and environment resolution
test/             bun tests
```

## Verification

1. `bun install` and `bun test`.
2. Install the plugin for a real OpenCode run and confirm it loads.
3. Drive a child `opencode run` to a completed turn and read the notification back
   from ntfy with a JSON poll.