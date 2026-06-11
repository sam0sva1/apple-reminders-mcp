# Apple Reminders MCP

An [MCP](https://modelcontextprotocol.io) server that gives an AI assistant (Claude Code, Claude
Desktop, or any MCP client) full read/write access to **Apple Reminders** on macOS.

Reminders you create through it sync to your iPhone, iPad, and Watch automatically via iCloud —
set a time and the alert pops up on your phone.

```
You:    "Remind me to call the dentist tomorrow at 10am."
Claude: → create-reminder { title: "Call the dentist", remindAt: "2026-06-13T10:00" }
        ✓ Reminder created — alert at 2026-06-13T10:00  (and it's now on your phone)
```

## Requirements

- **macOS** (uses EventKit + the Reminders database)
- **Node.js 20+**
- **Xcode Command Line Tools** to compile the helper at build time — `xcode-select --install`

## Install

```bash
git clone <this-repo> apple-reminders-mcp
cd apple-reminders-mcp
npm install
npm run build      # tsc + swiftc → build/reminders-helper
```

## Register with your MCP client

### Claude Code

A project-scoped `.mcp.json` ships with the repo, so launching Claude Code from the project
directory picks the server up automatically. To use it from anywhere, register globally:

```bash
claude mcp add apple-reminders --scope user -- node /absolute/path/to/apple-reminders-mcp/build/index.js
```

### Claude Desktop (or any client)

Add to the client's MCP config:

```json
{
  "mcpServers": {
    "apple-reminders": {
      "command": "node",
      "args": ["/absolute/path/to/apple-reminders-mcp/build/index.js"]
    }
  }
}
```

Add `"env": { "READONLY_MODE": "true" }` to expose only the read tools (no create/update/delete).

### First run: grant access

The first call triggers a macOS permission prompt asking to allow the controlling app (your
terminal / Claude) to access Reminders — **approve it**. Review or change it later under
**System Settings → Privacy & Security → Reminders**.

## Key concept: alerts vs. due dates

Apple Reminders has two separate time fields, and only one of them notifies you:

| Parameter | Maps to | Notifies your phone? |
|-----------|---------|----------------------|
| `remindAt` | "remind me" alarm + due date | **Yes** — this is the push |
| `dueAt`    | due date only               | No — just a soft deadline |

**To get pinged on your phone, set `remindAt`.**

### Date format

Always **ISO 8601 in local time, no timezone suffix**:

- `2026-06-12` → date only → an **all-day** reminder; its alert defaults to 09:00
- `2026-06-12T14:30` → a reminder at a specific time

A `Z` or `+02:00` suffix is rejected on purpose: silently shifting a reminder's wall-clock time
would be surprising. Components are passed to the helper as integers, never parsed from a
locale-dependent string.

## Tools

### Read

| Tool | Parameters | Returns |
|------|------------|---------|
| `list-lists` | — | all reminder list names |
| `list-reminders` | `list?`, `includeCompleted?` | reminders (incomplete only by default) |
| `get-reminder` | `id?` / `name?`, `list?` | one reminder's full details |

### Write (disabled when `READONLY_MODE=true`)

| Tool | Parameters |
|------|------------|
| `create-reminder` | `title`, `notes?`, `list?`, `remindAt?`, `dueAt?`, `priority?` → returns new `id` |
| `complete-reminder` | `id?` / `name?`, `list?`, `completed?` (false reopens) |
| `update-reminder` | `id?` / `name?`, `list?`, + any of `title`, `notes`, `remindAt`, `dueAt`, `priority`, `completed` |
| `delete-reminder` | `id?` / `name?`, `list?` |
| `create-list` | `name` |

### Utility

- `get-help` — returns this document.

### Identifying a reminder

Every listing returns a stable `id` — **prefer it** for update/complete/delete. You may instead
pass a `name`; if several reminders share that name, add `list` to disambiguate (otherwise the
operation errors rather than guessing).

`priority` follows Apple's convention: `0` none, `1` high, `5` medium, `9` low.

## Examples

```jsonc
// All-day reminder on a date (alerts at 09:00), in a specific list
create-reminder { "title": "Pay rent", "remindAt": "2026-07-01", "list": "Bills" }

// Timed reminder with a note and high priority
create-reminder { "title": "Standup", "notes": "share blockers", "remindAt": "2026-06-12T09:30", "priority": 1 }

// See what's open in one list
list-reminders { "list": "Work" }

// Complete by id (preferred)
complete-reminder { "id": "6D5FC33D-0CA2-4322-8FDE-4B860B79E9C6" }

// Reschedule
update-reminder { "id": "6D5FC33D-...", "remindAt": "2026-06-13T14:00" }
```

## Architecture

The server is a thin MCP shell (TypeScript + the MCP SDK, `zod`-validated inputs) over an
**EventKit helper binary** (`helper/RemindersHelper.swift`, compiled to `build/reminders-helper`).
Node sends the helper a JSON request on argv and parses a JSON response — no shell string
interpolation, so there's no injection surface.

EventKit is used rather than AppleScript on purpose: the Reminders AppleScript bridge degrades
badly at scale (on a ~1500-item list a single read took ~80s, a single create ~23s), while
EventKit handles the same store in a few hundred milliseconds. The tool layer is
backend-agnostic — `RemindersManager` could swap engines without changing any tool.

## Development

```bash
npm test         # vitest — pure logic (ISO date handling, helper transport/envelope)
npm run lint
npm run format
```

`REMINDERS_HELPER_PATH` overrides the compiled-helper location if you relocate the binary.

## Troubleshooting

- **"Reminders access not granted"** — approve the prompt, or enable the controlling app under
  System Settings → Privacy & Security → Reminders.
- **"helper failed to run"** — run `npm run build`; the Swift binary must exist at
  `build/reminders-helper`.
- **Nothing syncs to phone** — make sure Reminders uses an iCloud account and you set `remindAt`
  (not just `dueAt`).

## Limitations

- macOS only.
- Subtasks, recurrence rules, and location-based alerts are not exposed.
- Name-based lookup scans reminders; for unambiguous targeting prefer `id`.

## License

MIT — see [LICENSE](LICENSE).
