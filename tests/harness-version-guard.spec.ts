import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const versions = vi.hoisted(() => new Map<string, string>())
vi.mock('node:module', async importOriginal => {
  const original = await importOriginal<typeof import('node:module')>()
  return { ...original, createRequire: (url: string) => {
    const require = original.createRequire(url)
    return (id: string) => versions.has(id) ? { version: versions.get(id) } : require(id)
  } }
})
import { assertHarnessCompatibility } from '../src/harness-compat.js'

const peers = ['dsh-permission-presets', 'dsh-tools', 'dsh-llm', 'dsh-session', 'dsh-user-approval']
const use = (version: string) => peers.forEach(name => versions.set(`@deepseek-ai/${name}/package.json`, version))
const matrix = JSON.parse(readFileSync(new URL('../compatibility.json', import.meta.url), 'utf8'))
beforeEach(() => versions.clear())

describe('Harness version guard', () => {
  it.each(matrix.supportedHosts.map((host: { version: string }) => host.version))('accepts the coherent %s cohort', version => {
    use(version as string)
    expect(() => assertHarnessCompatibility()).not.toThrow()
  })
  it('accepts the reported RC.2 upgrade but rejects a mixed cohort even when each version is supported', () => {
    use('0.1.5-rc.2')
    expect(() => assertHarnessCompatibility()).not.toThrow()
    versions.set('@deepseek-ai/dsh-session/package.json', '0.1.5-rc.1')
    expect(() => assertHarnessCompatibility()).toThrow(/unsupported or mixed Harness/)
  })
  it.each(['0.1.6-alpha.2', '0.1.5-rc.3', '0.1.1-rc.2'])('rejects unverified %s with recovery instructions', version => {
    use(version)
    expect(() => assertHarnessCompatibility()).toThrow(/dsh plugin --profile <name> remove @nanmicoder\/dsh-auto-mode/)
    expect(() => assertHarnessCompatibility()).toThrow(/Do not rename the auto preset alone/)
  })
})
