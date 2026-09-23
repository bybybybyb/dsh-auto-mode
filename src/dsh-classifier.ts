import { randomUUID } from 'node:crypto'
import {
  ReasoningEffortId,
  type GenerateOptions,
  type LlmFailure,
  type LlmResolvedModelInfo,
  type Message,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { CLASSIFIER_SYSTEM_PROMPT, parseClassifierDecision } from './classifier.js'
import type { ClassifierDecision, ClassifierInput, SafetyClassifier } from './types.js'

/**
 * Ordinary answer budget. The classifier returns one strict two-key JSON object,
 * so this only has to cover a verbose decision plus its reason.
 */
export const DEFAULT_CLASSIFIER_MAX_OUTPUT_TOKENS = 2_048
/**
 * Answer budget for a route that cannot disable thinking. Reasoning tokens share
 * the output cap with the answer, so the ordinary budget can be consumed before
 * any JSON is emitted; this is the largest value `classifierMaxOutputTokens`
 * accepts.
 */
export const REASONING_CLASSIFIER_MAX_OUTPUT_TOKENS = 4_096
/** Effort pinned on classifier requests unless configuration overrides it. */
export const DEFAULT_CLASSIFIER_REASONING_EFFORT = 'off'

interface LlmStreamRuntime {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  /**
   * Optional exact-route capability probe. Its answer decides whether the `off`
   * effort may be pinned at all, and in the inherited case it reports which
   * effort the adapter will apply instead. An absent or failing probe falls back
   * to pinning anyway and relies on the rejected-pin retry, so a stream-only test
   * seam still works.
   */
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
}

/** Configuration for a classifier that reuses the current Harness LLM route. */
export interface DshClassifierConfig {
  readonly timeoutMs: number
  readonly maxOutputTokens?: number
  /**
   * Effort pinned on classifier requests. The default `off` stops thinking tokens
   * from consuming the answer budget; an empty string inherits the adapter
   * default instead.
   */
  readonly reasoningEffort?: string
  readonly provider?: string
  readonly model?: string
}

function classifierPayload(input: ClassifierInput): string {
  return JSON.stringify({
    toolName: input.toolName,
    arguments: input.arguments,
    workspaceRoot: input.workspaceRoot,
    policyReason: input.policyReason,
    trustedUserMessages: input.trustedUserMessages,
    filesystemEffects: input.filesystemEffects,
    sandboxRequest: input.sandboxRequest,
  })
}

function classifierMessage(input: ClassifierInput): Message {
  return Object.freeze({
    id: `auto-mode-classifier-${randomUUID()}` as Message['id'],
    role: 'user' as const,
    content: [{ type: 'text' as const, text: classifierPayload(input) }],
    source: { kind: 'plugin' as const, plugin: '@nanmicoder/dsh-auto-mode' },
  })
}

function jsonText(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)
  return fenced?.[1]?.trim() ?? trimmed
}

/**
 * Rebuild an adapter failure as an Error, keeping every diagnostic field.
 *
 * `code` routes the rejected-pin retry; `status` and `requestId` are what let an
 * operator correlate a provider failure with provider-side logs, so dropping them
 * here would lose the only handle on a real incident.
 */
function finishFailureError(failure: LlmFailure): Error {
  return Object.assign(new Error(failure.message), failure)
}

interface CollectedResponse {
  readonly text: string
  readonly finish: Extract<StreamChunk, { type: 'finish' }>['reason']
}

async function collectResponse(runtime: LlmStreamRuntime, options: GenerateOptions): Promise<CollectedResponse> {
  const textByIndex = new Map<number, string>()
  let finish: CollectedResponse['finish'] | undefined
  let size = 0
  for await (const chunk of runtime.stream(options)) {
    if (chunk.type === 'text-delta') {
      const value = (textByIndex.get(chunk.index) ?? '') + chunk.text
      textByIndex.set(chunk.index, value)
      size += chunk.text.length
    } else if (chunk.type === 'block-end') {
      if (chunk.block.type === 'tool-call') throw new Error('classifier unexpectedly requested a tool')
      if (chunk.block.type === 'text') {
        textByIndex.set(chunk.index, chunk.block.text)
        size = [...textByIndex.values()].reduce((total, value) => total + value.length, 0)
      }
    } else if (chunk.type === 'tool-call-delta') {
      throw new Error('classifier unexpectedly requested a tool')
    } else if (chunk.type === 'finish') {
      finish = chunk.reason
    }
    if (size > 20_000) throw new Error('classifier response is too large')
  }
  if (finish === undefined) throw new Error('classifier response has no finish reason')
  return {
    text: [...textByIndex.entries()].sort(([left], [right]) => left - right).map(([, text]) => text).join(''),
    finish,
  }
}

/**
 * Turn one collected response into a decision, or throw the fail-closed reason.
 *
 * A truncated response is never partially trusted. A `max-tokens` finish is
 * refused before the text is even parsed, because the only way to recover a
 * decision from a partial answer is to guess whether the model concluded it or
 * merely quoted text that arrived as untrusted input, and no provenance signal
 * exists to tell those apart. Refusing the whole response keeps the classifier's
 * failure mode a denial, which is what the policy already does with every other
 * malformed answer.
 */
function decisionFromResponse(response: CollectedResponse): ClassifierDecision {
  const { finish, text } = response
  if (finish.kind === 'error' || finish.kind === 'aborted') throw finishFailureError(finish.failure)
  if (finish.kind === 'tool-calls') throw new Error('classifier unexpectedly requested a tool')
  if (finish.kind === 'max-tokens') throw new Error('classifier response reached its output limit')
  // `FinishReasonMap` is merge-extensible, so allow-list the one kind that means
  // the model finished its answer. An unmodelled kind is not a licence to parse.
  if (finish.kind !== 'stop') {
    throw new Error(`classifier response stopped for an unsupported reason: ${String((finish as { kind: string }).kind)}`)
  }
  return parseClassifierDecision(JSON.parse(jsonText(text)))
}

function isUnsupportedEffort(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === 'UNSUPPORTED_REASONING_EFFORT'
}

interface EffortPlan {
  /** Effort to send, or undefined to inherit the adapter default. */
  readonly effort?: string
  /**
   * Whether the call may spend part of its answer budget on reasoning tokens.
   *
   * True unless this plan actually pins `off`. `maxTokens` is a ceiling rather
   * than a reservation, so over-reserving it costs nothing, while under-reserving
   * it re-creates the truncation this module exists to avoid.
   */
  readonly thinkingMayBeOn: boolean
  /** A capability probe that threw, kept so a later failure can name its cause. */
  readonly probeFailure?: unknown
}

/**
 * Decide which effort to pin on this exact route.
 *
 * Harness `resolveCallWithInfo` (reached through `LlmService.adapterStream`)
 * materializes the adapter's advertised
 * `defaultEffort` whenever a caller omits one, and the DeepSeek adapter
 * advertises `high`. Reasoning then shares the output cap with the answer, which
 * is what truncated a 1024-token classifier call to `finish_reason: "length"` and
 * failed closed. Pinning `off` puts `thinking: { type: "disabled" }` on the wire
 * instead, which is the only outcome that proves reasoning cannot consume the cap.
 *
 * Every other outcome keeps the larger cap, including two that are easy to get
 * wrong:
 *
 * - An inherited effort (`requested` empty). The adapter's own `defaultEffort`
 *   then applies, so the probe is consulted for it rather than assumed harmless.
 * - A route that publishes no reasoning metadata. It rejects *any* explicit
 *   effort, so nothing is sent — but that is not evidence the provider is not
 *   thinking. `@deepseek-ai/dsh-llm-pi-ai` documents this exact hazard: selecting
 *   `off` there means omitting the option, and a provider whose own default is to
 *   think keeps thinking.
 */
async function planReasoningEffort(
  runtime: LlmStreamRuntime,
  provider: string,
  model: string,
  requested: string | undefined,
  signal: AbortSignal,
): Promise<EffortPlan> {
  const inherit = requested === undefined || requested === ''
  let info: LlmResolvedModelInfo | undefined
  let probeFailure: unknown
  if (runtime.resolveModelInfo !== undefined) {
    try {
      info = await runtime.resolveModelInfo(provider, model, signal)
    } catch (error: unknown) {
      // The probe is advisory: an unknown route still gets the pin, and an adapter
      // that rejects it is retried without the pin. The failure is kept so a later
      // classifier error can name it instead of surfacing as an unrelated symptom.
      probeFailure = error
    }
  }
  const reasoning = info?.reasoning
  const efforts = Array.isArray(reasoning?.efforts) ? reasoning.efforts : []
  const withProbe = (plan: EffortPlan): EffortPlan => probeFailure === undefined ? plan : { ...plan, probeFailure }

  if (inherit) {
    // No effort is sent, so the adapter's default applies. It is off only when the
    // probe positively reports the `off` effort as that default.
    const inherited = reasoning?.defaultEffort
    return withProbe({ thinkingMayBeOn: inherited === undefined || inherited !== DEFAULT_CLASSIFIER_REASONING_EFFORT })
  }
  if (info === undefined) {
    // No probe available, or it failed: keep the pin and rely on the rejected-pin retry.
    return withProbe({ effort: requested, thinkingMayBeOn: requested !== DEFAULT_CLASSIFIER_REASONING_EFFORT })
  }
  // No usable reasoning metadata: the route rejects every explicit effort, so
  // nothing is sent, and the budget must stay generous.
  if (reasoning === undefined || efforts.length === 0) return withProbe({ thinkingMayBeOn: true })
  if (efforts.some(entry => entry.id === requested)) {
    return withProbe({ effort: requested, thinkingMayBeOn: requested !== DEFAULT_CLASSIFIER_REASONING_EFFORT })
  }
  const off = efforts.find(entry => entry.id === DEFAULT_CLASSIFIER_REASONING_EFFORT)
  // A route that offers no `off` cannot disable thinking, so it needs the larger cap.
  return withProbe(off === undefined ? { thinkingMayBeOn: true } : { effort: off.id, thinkingMayBeOn: false })
}

/** Reuse `ctx.llm` for an independent, low-token classifier request. */
export function createDshClassifier(runtime: LlmStreamRuntime, config: DshClassifierConfig): SafetyClassifier {
  const overridePair = config.provider !== undefined || config.model !== undefined
  if (overridePair && (config.provider === undefined || config.model === undefined)) {
    throw new Error('classifierProvider and classifierModel must be configured together')
  }
  const reasoningEffort = config.reasoningEffort?.trim()
  // A typo here is not inert: it is coerced to `off` on one route and dropped on
  // another, so both look like a working configuration. Reject it at the seam.
  if (reasoningEffort !== undefined && reasoningEffort !== '' && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(reasoningEffort)) {
    throw new Error('classifierReasoningEffort must be an adapter effort id such as "off", or an empty string to inherit the adapter default')
  }
  return {
    async classify(input: ClassifierInput, signal: AbortSignal): Promise<ClassifierDecision> {
      const route = config.provider === undefined
        ? input.route
        : { provider: config.provider, model: config.model as string }
      if (route === undefined || route.provider === '' || route.model === '') {
        throw new Error('current session has no provider/model route for classification')
      }
      const timeout = AbortSignal.timeout(config.timeoutMs)
      const combined = AbortSignal.any([signal, timeout])
      const cap = config.maxOutputTokens ?? DEFAULT_CLASSIFIER_MAX_OUTPUT_TOKENS
      const buildOptions = (effort: string | undefined, thinkingMayBeOn: boolean): GenerateOptions => ({
        provider: route.provider,
        model: route.model,
        messages: [classifierMessage(input)],
        system: CLASSIFIER_SYSTEM_PROMPT,
        temperature: 0,
        maxTokens: thinkingMayBeOn ? Math.max(cap, REASONING_CLASSIFIER_MAX_OUTPUT_TOKENS) : cap,
        signal: combined,
        ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
      })
      let probeFailure: unknown
      try {
        // The probe runs inside this try so a cancellation or timeout it observes is
        // still translated to the caller-facing wording. Its own metadata failures
        // are advisory and fall back to the pin — see `planReasoningEffort`.
        const plan = await planReasoningEffort(
          runtime, route.provider, route.model, reasoningEffort ?? DEFAULT_CLASSIFIER_REASONING_EFFORT, combined,
        )
        probeFailure = plan.probeFailure
        try {
          return decisionFromResponse(await collectResponse(runtime, buildOptions(plan.effort, plan.thinkingMayBeOn)))
        } catch (error: unknown) {
          // The route refused the pin (an unverifiable probe, or an adapter whose
          // metadata disagrees). One retry without it still classifies instead of
          // failing closed for every call on that route, and that retry inherits
          // the adapter default, so thinking may now be on.
          if (plan.effort === undefined || !isUnsupportedEffort(error)) throw error
          return decisionFromResponse(await collectResponse(runtime, buildOptions(undefined, true)))
        }
      } catch (error: unknown) {
        if (signal.aborted) {
          throw new Error('classifier request cancelled because the pending tool call was aborted', { cause: error })
        }
        if (timeout.aborted) {
          throw new Error(`classifier timed out after ${config.timeoutMs}ms`, { cause: error })
        }
        if (probeFailure === undefined) throw error
        // A failing capability probe would otherwise be reported as the symptom of
        // whatever the attempt did next.
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(message, { cause: { probeFailure, error } })
      }
    },
  }
}
