# dsh-self-restart

Let the agent restart DSH Desktop itself — safely.

## Why

The agent's shell tool runs as a **child of the Desktop main process**. Any
watchdog it spawns with `nohup`/`disown` dies with the Desktop process tree
(those only survive SIGHUP). This plugin materializes a watchdog script and
a double-fork + `setsid()` launcher: the watchdog escapes into its own
session, gets reparented to launchd, then kills Desktop, relaunches it, and
polls a health URL — writing progress to a status file the next turn reads.

Verified end-to-end: kill → relaunch → healthy in ~3 seconds.

## Usage

The agent calls the `desktop_restart` tool. The call never meaningfully
returns — the turn dies mid-stream. The plugin records which session asked;
after the watchdog reports HEALTHY, the next boot **resumes that session and
wakes it with a followup message**, so the agent continues its post-restart
verification without a user poke. Status file for manual inspection:

```bash
cat /tmp/dsh-self-restart.status
# 2026-09-02T01:27:40Z killing
# 2026-09-02T01:27:41Z relaunching
# 2026-09-02T01:27:43Z HEALTHY after 3s
```

## Config

```yaml
- id: self-restart
  config:
    appPath: /Applications/DSH Desktop.app   # default
    healthUrl: http://127.0.0.1:43120/       # default
    statusFile: /tmp/dsh-self-restart.status # default
```

## Test

```
npm test   # node --experimental-strip-types --test
```
