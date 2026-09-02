/** Resume-intent tests — closing the self-restart loop. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileIntentStore, readHealthyAt, makeUserMessage, continueAfterRestart } from '../src/resume-intent.ts'

function tmp() { return mkdtempSync(join(tmpdir(), 'sr-intent-')) }

test('intent store roundtrip and clear', () => {
  const store = fileIntentStore(tmp())
  assert.equal(store.read(), undefined)
  store.write({ agentId: 'session-x', requestedAt: '2026-09-02T01:00:00Z' })
  assert.equal(store.read()?.agentId, 'session-x')
  store.clear()
  assert.equal(store.read(), undefined)
})

test('readHealthyAt parses watchdog status', () => {
  const f = join(tmp(), 'status')
  assert.equal(readHealthyAt(f), undefined)
  writeFileSync(f, '2026-09-02T01:27:40Z killing\n2026-09-02T01:27:41Z relaunching\n2026-09-02T01:27:43Z HEALTHY after 3s\n')
  assert.equal(readHealthyAt(f), Date.parse('2026-09-02T01:27:43Z'))
})

test('makeUserMessage matches the agent-loop wire shape', () => {
  const m = makeUserMessage('hi') as any
  assert.equal(m.role, 'user')
  assert.deepEqual(m.content, [{ type: 'text', text: 'hi' }])
  assert.equal(m.source.kind, 'user')
  assert.ok(m.id)
})

test('continueAfterRestart resumes offline session and wakes it', async () => {
  const dir = tmp()
  const statusFile = join(dir, 'status')
  const store = fileIntentStore(dir)
  store.write({ agentId: 'session-42', requestedAt: '2026-09-02T01:00:00Z' })
  writeFileSync(statusFile, '2026-09-02T01:00:05Z HEALTHY after 2s\n')
  const woken: any[] = []
  const agents = {
    get: () => undefined,
    resume: async (opts: any) => ({
      agent: { id: opts.resumeSessionId, followup: (m: any) => woken.push(m) },
    }),
  }
  const outcome = await continueAfterRestart({ agents, intent: store, statusFile, logger: () => {} })
  assert.match(outcome, /resumed session-42/)
  assert.equal(woken.length, 1)
  assert.match(woken[0].content[0].text, /restarted and is healthy/)
  assert.equal(store.read(), undefined, 'intent consumed')
})

test('continueAfterRestart uses the live agent when present (no resume)', async () => {
  const dir = tmp()
  const statusFile = join(dir, 'status')
  const store = fileIntentStore(dir)
  store.write({ agentId: 'session-live', requestedAt: '2026-09-02T01:00:00Z' })
  writeFileSync(statusFile, '2026-09-02T01:00:05Z HEALTHY after 1s\n')
  const woken: any[] = []
  const agents = {
    get: (id: string) => ({ id, followup: (m: any) => woken.push(m) }),
    resume: async () => { throw new Error('must not resume a live agent') },
  }
  await continueAfterRestart({ agents, intent: store, statusFile, logger: () => {} })
  assert.equal(woken.length, 1)
})

test('no intent or stale status → no-op', async () => {
  const dir = tmp()
  const statusFile = join(dir, 'status')
  const store = fileIntentStore(dir)
  const agents = { get: () => { throw new Error('no call expected') } }
  assert.match(await continueAfterRestart({ agents, intent: store, statusFile, logger: () => {} }), /no pending intent/)
  store.write({ agentId: 's', requestedAt: '2026-09-02T02:00:00Z' })
  writeFileSync(statusFile, '2026-09-02T01:00:00Z HEALTHY after 1s\n')  // predates intent
  assert.match(await continueAfterRestart({ agents, intent: store, statusFile, logger: () => {} }), /stale/)
})
