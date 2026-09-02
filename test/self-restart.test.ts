/**
 * self-restart tests — the watchdog/launcher contract that made
 * "agent restarts its own host" work (2026-09-02).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchdogScript, launcherSource, materialize } from '../src/index.ts'

test('watchdog script kills, relaunches, and health-checks', () => {
  const s = watchdogScript('/Applications/DSH Desktop.app', 'http://127.0.0.1:43120/', '/tmp/x.status')
  assert.match(s, /pkill -f "Contents\/MacOS\/DSH Desktop"/)
  assert.match(s, /open -a "\/Applications\/DSH Desktop\.app"/)
  assert.match(s, /curl -s -o \/dev\/null --max-time 2 "http:\/\/127\.0\.0\.1:43120\/"/)
  assert.match(s, /HEALTHY after/)
  assert.match(s, /FAILED: web not healthy after 60s/)
})

test('launcher escapes the Desktop session via double-fork + setsid', () => {
  const l = launcherSource('/x/watchdog.sh')
  // The lesson of 2026-09-02: nohup/disown only survive SIGHUP; the agent's
  // process tree dies WITH Desktop. setsid is the escape hatch.
  assert.match(l, /os\.setsid\(\)/)
  assert.equal((l.match(/os\.fork\(\)/g) ?? []).length, 2, 'double-fork required')
  assert.match(l, /subprocess\.call\(\['\/bin\/bash', "\/x\/watchdog\.sh"\]\)/)
})

test('materialize writes executable files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sr-'))
  const paths = materialize(dir, {
    appPath: '/Applications/DSH Desktop.app',
    healthUrl: 'http://127.0.0.1:43120/',
    statusFile: '/tmp/x.status',
  })
  assert.ok(existsSync(paths.script))
  assert.ok(existsSync(paths.launcher))
  assert.ok(statSync(paths.script).mode & 0o111, 'watchdog must be executable')
  assert.ok(readFileSync(paths.script, 'utf8').startsWith('#!/bin/bash'))
})

test('apply registers desktop_restart with tools service', () => {
  const registered: any[] = []
  const ctx = {
    logger: () => Object.assign(() => {}, { info: () => {}, warn: () => {}, error: () => {} }),
    tools: { register: (def: any) => { registered.push(def); return () => {} } },
  }
  // dynamic import to call apply with our stub
  return import('../src/index.ts').then((m) => {
    m.apply(ctx, {})
    assert.equal(registered.length, 1)
    assert.equal(registered[0].name, 'desktop_restart')
    assert.equal(typeof registered[0].execute, 'function')
    assert.match(registered[0].description, /turn will be cut off/)
  })
})
