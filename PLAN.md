# oc-notifyondone

An OpenCode plugin that sends an [ntfy](https://ntfy.sh) message when a model finishes responding.

## Goal

Deliver a notification through ntfy whenever an OpenCode session goes idle after a
model turn completes, so long-running work can be monitored from a phone.

## Approach

### Event source

Subscribe to the public server event stream with `ctx.event.subscribe()` and act on
the execution lifecycle:

- `session.step.ended` is the finished-response signal. A `tool-calls` finish is
  followed by more work, so it does not notify; any other finish does.
- `session.execution.failed` covers turns that never reach a final step.
- `session.execution.interrupted` is ignored: a cancelled run is not a finished response.
- `session.status` and the deprecated `session.idle` are fallbacks.

Events are keyed by the assistant message ID so a repeated event notifies once, with
a bounded key set so a long-lived server cannot grow it.

`session.status` was the first choice of signal, but a real run does not emit it.
Verified against the stream: a completed `opencode run` produces
`session.execution.started`, `session.step.started`, `session.text.*`,
`session.step.streamed`, `session.step.ended`, `session.usage.updated`,
`session.execution.succeeded`, then `location.shutdown`.

### Message content

The body comes from `session.text.ended`, which carries the completed text block keyed by
assistant message ID. That avoids a session read on the common path. When no text was
observed, fall back to `ctx.session.get()` plus `ctx.session.context()`.

- Title: `OpenCode: <project directory name>` by default, overridable per plugin option.
- Body: final assistant text, collapsed to a single line and length-capped.

### Transport

A single `fetch` POST to `<server>/<topic>` with `Content-Type: text/plain`, plus
optional `Title`, `Priority`, `Tags`, `Click`, and `Authorization` headers when
configured. No ntfy SDK dependency is required.

A one-shot `opencode run` exits as soon as the turn ends, which can kill an in-flight
POST. The cleanup function awaits any pending delivery. Verified: without the wait the
POST was cut off on `--standalone`; with it, delivery completes.

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
index.ts          package entrypoint, re-exports src
src/index.ts      plugin definition, event loop, notification composition
src/notify.ts     ntfy delivery
src/options.ts    option and environment resolution
src/summary.ts    text collapsing and assistant-text extraction
test/             bun tests
```

## Verification

1. `bun install`, `bun test`, `bunx tsc --noEmit`.
2. Configure the plugin in a scratch project and confirm `opencode plugin list` resolves it.
3. Drive a child `opencode run` to a completed turn and read the notification back
   from ntfy with a JSON poll. Confirmed for both the shared service and `--standalone`.