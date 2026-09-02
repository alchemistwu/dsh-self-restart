/**
 * Resume-intent: close the self-restart loop.
 *
 * desktop_restart kills the caller's turn mid-stream. Without a wake-up the
 * agent never learns the restart finished — the user had to poke it. The
 * plugin now (1) records WHICH session asked for the restart (from the tool
 * execution's agent identity), (2) after the watchdog reports HEALTHY, the
 * next boot resumes that session and injects a followup message, and the
 * agent continues its post-restart verification from conversation history.
 *
 * NOTE: Node strip-only TS — no parameter properties, no enums.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface RestartIntent {
  agentId: string
  requestedAt: string
  note?: string
}

export interface IntentStore {
  read(): RestartIntent | undefined
  write(intent: RestartIntent): void
  clear(): void
}

export function fileIntentStore(dir: string): IntentStore {
  const file = join(dir, 'restart-intent.json')
  return {
    read() {
      try {
        const d = JSON.parse(readFileSync(file, 'utf8'))
        if (typeof d?.agentId === 'string' && d.agentId) return d as RestartIntent
      } catch { /* absent or corrupt */ }
      return undefined
    },
    write(intent) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, JSON.stringify(intent, null, 2))
    },
    clear() {
      try { writeFileSync(file, 'null') } catch { /* non-fatal */ }
    },
  }
}

/** Watchdog status: HEALTHY lines look like `... HEALTHY after 3s`. */
export function readHealthyAt(statusFile: string): number | undefined {
  try {
    const text = readFileSync(statusFile, 'utf8')
    const m = text.match(/^(\S+) HEALTHY after \d+s$/m)
    if (m) return Date.parse(m[1])
  } catch { /* missing */ }
  return undefined
}

export function makeUserMessage(text: string) {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/**
 * Boot-time continuation: if the watchdog says the last restart went HEALTHY
 * after an intent was recorded, resume the originating agent and wake it.
 * Returns a human-readable outcome for logging.
 */
export async function continueAfterRestart(opts: {
  agents: any
  intent: IntentStore
  statusFile: string
  logger: (msg: string, ...rest: unknown[]) => void
}): Promise<string> {
  const intent = opts.intent.read()
  if (!intent) return 'no pending intent'
  const healthyAt = readHealthyAt(opts.statusFile)
  if (!healthyAt) return 'no healthy status'
  if (healthyAt < Date.parse(intent.requestedAt)) return 'stale status (predates intent)'
  const agent = opts.agents.get(intent.agentId)
  try {
    const target = agent ?? (await opts.agents.resume({ resumeSessionId: intent.agentId })).agent
    target.followup(makeUserMessage(
      `[self-restart] Desktop restarted and is healthy (${new Date(healthyAt).toISOString()}). ` +
      `This restart was requested by you in this session — continue your pending work.`))
    opts.intent.clear()
    return `resumed ${intent.agentId}`
  } catch (err) {
    return `resume failed: ${(err as Error).message.slice(0, 120)}`
  }
}
