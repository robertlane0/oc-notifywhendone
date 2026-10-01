# oc-notifyondone

An OpenCode plugin that sends an [ntfy](https://ntfy.sh) message when a model finishes responding.

## Install

Point OpenCode at the package directory:

```jsonc
// opencode.json  (or ~/.config/opencode/opencode.json to load it everywhere)
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/path/to/oc-notifyondone",
      "options": { "topic": "my-secret-topic" }
    }
  ]
}
```

A topic is required. On ntfy.sh the topic name is effectively the password, so pick
something unguessable. For a self-hosted server, set `server` too.

## What it sends

One message per finished response:

- **Title**: `OpenCode: <project directory name>`
- **Body**: the model's final text, collapsed to one line and capped at 300 characters

Interrupted runs are ignored. A run that ends in failure is prefixed `Failed:`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `topic` | — | Required. Topic on the ntfy server. |
| `server` | `https://ntfy.sh` | Base URL. Set this for a self-hosted ntfy. |
| `title` | `OpenCode` | Title prefix. |
| `priority` | `default` | `min`, `low`, `default`, `high`, or `urgent`. |
| `tags` | — | Comma-separated ntfy tags or emoji names. |
| `token` | — | Access token for a protected topic. `user:pass` is sent as basic auth. |
| `maxLength` | `300` | Maximum characters kept from the model's text. |
| `enabled` | `true` | Set `false` to disable delivery without removing the plugin. |

Environment variables work as fallbacks when no option is set: `NTFY_TOPIC`,
`NTFY_SERVER`, `NTFY_TOKEN`, `NTFY_TAGS`.

## How it detects a finished response

A turn ends at `session.step.ended` when the model finishes on something other than
`tool-calls`; a tool-calling step is followed by more work, so it does not notify.
`session.execution.failed` covers turns that never reach a final step. Both are keyed
by the assistant message ID, so a repeated event notifies once.

`session.status` and the deprecated `session.idle` are accepted as fallbacks. The
notification body comes from `session.text.ended`, so the common path needs no extra
session read; the plugin falls back to reading session context when it saw no text.

A short-lived `opencode run` tears down as soon as the turn ends, so cleanup waits for
an in-flight delivery to finish.

## Troubleshooting

Set `NTFY_DEBUG_FILE` to append plugin diagnostics to a file:

```sh
NTFY_DEBUG_FILE=/tmp/ntfy-trace.log opencode run "..."
```

Each line records the composed notification and the delivery result. Delivery failures
are also written to the OpenCode log.

## Development

```sh
bun install
bun test
bunx tsc --noEmit
```

Requires OpenCode 2 (`@opencode/plugin` >= 2.0.0). `PLAN.md` holds the design notes.