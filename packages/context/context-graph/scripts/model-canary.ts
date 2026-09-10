/**
 * Model-drift detection for the Layer 2 pilots.
 *
 * These pilots compare arms of an agent-behavior experiment against a
 * hosted model. That model can change under you without notice, and it
 * did: mid-investigation, `deepseek-v4-flash` went from failing task
 * `6cbf927e` on 10 of 10 no-recall trials to passing it on 5 of 5, with a
 * total-token spread of eight tokens at `temperature: 0`. Because nothing
 * recorded which model version produced which dataset, several days of
 * results had already been pooled across the change before an accidental
 * re-measurement of an old cell exposed it. The write-up in
 * 2026-09-05-context-graph-replay-verification calls that pooling unsafe
 * and prescribes this module as the fix.
 *
 * Two independent signals, because either alone can miss:
 *
 * - **Provider fingerprint.** DeepSeek returns `system_fingerprint` and a
 *   resolved `model` on every completion. Note the resolved name differs
 *   from the requested one (`deepseek-v4-flash` resolves to
 *   `deepseek-flash`), so the requested name is an alias that can be
 *   repointed silently — recording both is the point.
 * - **Canary response.** A fixed prompt at `temperature: 0` whose exact
 *   reply is hashed. This catches a behavior change the provider did not
 *   stamp with a new fingerprint, which is the failure mode that actually
 *   bit this investigation.
 *
 * Cost is roughly a hundred tokens per run, which is why it can run
 * unconditionally at the start of every pilot rather than being something
 * to remember to do.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'

/** Fixed across every probe forever — changing it invalidates every stored baseline. */
const CANARY_PROMPT = 'Reply with exactly: OK'

/** One observation of what the provider is actually serving. */
export interface ModelProbe {
  /** Model name as requested (an alias, in DeepSeek's case). */
  readonly requestedModel: string
  /** Model name the provider resolved the request to. */
  readonly resolvedModel: string
  /** Provider-stamped serving version, when exposed. */
  readonly systemFingerprint: string
  /** SHA-256 of the canary reply, catching changes the fingerprint misses. */
  readonly canaryHash: string
  /** ISO timestamp of the probe. */
  readonly observedAt: string
}

export type DriftStatus = 'first-run' | 'stable' | 'drifted'

export interface DriftReport {
  readonly status: DriftStatus
  readonly probe: ModelProbe
  /** The stored observation this was compared against; absent on the first run. */
  readonly baseline?: ModelProbe
  /** Which fields differ; empty unless `status` is `drifted`. */
  readonly changed: readonly string[]
}

function post(apiKey: string, body: unknown): Promise<string> {
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = httpsRequest('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const status = res.statusCode ?? 0
        const text = Buffer.concat(chunks).toString('utf8')
        if (status < 200 || status >= 300) reject(new Error(`DeepSeek API error ${status}: ${text}`))
        else resolve(text)
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/**
 * Ask the provider what it is serving right now.
 * @param apiKey DeepSeek API key.
 * @param model Model name to request; recorded as `requestedModel`.
 * @returns One observation suitable for comparison against a stored baseline.
 */
export async function probeModel(apiKey: string, model: string): Promise<ModelProbe> {
  const raw = await post(apiKey, {
    model,
    messages: [{ role: 'user', content: CANARY_PROMPT }],
    temperature: 0,
    max_tokens: 16,
    thinking: { type: 'disabled' },
  })
  const body = JSON.parse(raw) as {
    model?: string
    system_fingerprint?: string
    choices?: Array<{ message?: { content?: string } }>
  }
  const reply = body.choices?.[0]?.message?.content ?? ''
  return {
    requestedModel: model,
    resolvedModel: body.model ?? 'unknown',
    systemFingerprint: body.system_fingerprint ?? 'unknown',
    canaryHash: createHash('sha256').update(reply, 'utf8').digest('hex').slice(0, 16),
    observedAt: new Date().toISOString(),
  }
}

/**
 * Compare a fresh probe against the stored baseline for the same requested
 * model, recording the baseline when there is none yet.
 *
 * A drifted result is deliberately not an error: the run should proceed and
 * say so loudly, because the whole point is that its results must not later
 * be pooled with data from the other side of the change.
 * @param probe Fresh observation from {@link probeModel}.
 * @param baselinePath JSON file holding one baseline per requested model.
 * @returns What changed, if anything.
 */
export function checkDrift(probe: ModelProbe, baselinePath: string): DriftReport {
  const store: Record<string, ModelProbe> = existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : {}
  const baseline = store[probe.requestedModel]
  if (baseline === undefined) {
    writeFileSync(baselinePath, `${JSON.stringify({ ...store, [probe.requestedModel]: probe }, undefined, 2)}\n`)
    return { status: 'first-run', probe, changed: [] }
  }
  const changed = (['resolvedModel', 'systemFingerprint', 'canaryHash'] as const)
    .filter(field => baseline[field] !== probe[field])
  return changed.length === 0
    ? { status: 'stable', probe, baseline, changed }
    : { status: 'drifted', probe, baseline, changed }
}

/**
 * Print a drift report at the top of a pilot run.
 * @param report Result of {@link checkDrift}.
 */
export function reportDrift(report: DriftReport): void {
  const { probe } = report
  const identity = `${probe.requestedModel} -> ${probe.resolvedModel} | fingerprint ${probe.systemFingerprint} | canary ${probe.canaryHash}`
  if (report.status === 'first-run') {
    console.log(`Model baseline recorded: ${identity}`)
    return
  }
  if (report.status === 'stable') {
    console.log(`Model unchanged since baseline: ${identity}`)
    return
  }
  console.error('='.repeat(78))
  console.error('WARNING: THE MODEL CHANGED SINCE THE STORED BASELINE.')
  console.error(`  changed: ${report.changed.join(', ')}`)
  console.error(`  baseline (${report.baseline?.observedAt}): ${report.baseline?.resolvedModel} | ${report.baseline?.systemFingerprint} | canary ${report.baseline?.canaryHash}`)
  console.error(`  now      (${probe.observedAt}): ${probe.resolvedModel} | ${probe.systemFingerprint} | canary ${probe.canaryHash}`)
  console.error('  This run\'s results MUST NOT be pooled with data collected before this point.')
  console.error('='.repeat(78))
}
