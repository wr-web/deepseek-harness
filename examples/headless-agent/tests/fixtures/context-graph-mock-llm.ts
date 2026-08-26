import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-context-graph'

/** Keyless adapter that refuses the target turn unless bounded recall reached the model request. */
class ContextGraphMockAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const directText = options.messages
      .filter(message => message.source.kind === 'user')
      .flatMap(message => message.content)
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('\n')
    if (directText.includes('analyze token cache invalidation')) {
      const reasoning = 'PRIVATE_SOURCE_REASONING'
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index: 0, text: reasoning }
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: reasoning } }
      const reply = 'SOURCE_CHECKPOINT: token cache invalidation uses a monotonic version stamp.'
      yield { type: 'block-start', index: 1, blockType: 'text' }
      yield { type: 'text-delta', index: 1, text: reply }
      yield { type: 'block-end', index: 1, block: { type: 'text', text: reply } }
      yield { type: 'usage', usage: { inputTokens: 40, outputTokens: 12 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    const recallText = options.messages
      .filter(message => message.source.kind === 'context-graph')
      .flatMap(message => message.content)
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('\n')
    if (!recallText.includes('monotonic version stamp')) throw new Error('context-graph recall did not reach target request')
    if (recallText.includes('PRIVATE_SOURCE_REASONING')) throw new Error('context-graph recall leaked private reasoning')
    const reply = 'TARGET_USED_RECALL'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 18, outputTokens: 4 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'context-graph-mock-llm'
export const inject = ['llm']

/** Register the keyless context-graph proof adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['context-graph-mock'], new ContextGraphMockAdapter())
}
