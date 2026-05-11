import { describe, expect, it } from 'vitest'
import { resolveSwarmModelLabel } from './swarm-model-resolver'

describe('resolveSwarmModelLabel', () => {
  it('returns null for empty / blank / sentinel labels', () => {
    expect(resolveSwarmModelLabel(null)).toBeNull()
    expect(resolveSwarmModelLabel('')).toBeNull()
    expect(resolveSwarmModelLabel('   ')).toBeNull()
    expect(resolveSwarmModelLabel('Worker')).toBeNull()
  })

  it('resolves Anthropic Opus labels', () => {
    expect(resolveSwarmModelLabel('Opus 4.7')).toEqual({
      provider: 'anthropic-oauth',
      default: 'claude-opus-4-7',
    })
    expect(resolveSwarmModelLabel('Claude Opus 4.6')).toEqual({
      provider: 'anthropic-oauth',
      default: 'claude-opus-4-6',
    })
    expect(resolveSwarmModelLabel('opus 4.5')).toEqual({
      provider: 'anthropic-oauth',
      default: 'claude-opus-4-5',
    })
  })

  it('resolves Claude Sonnet labels', () => {
    expect(resolveSwarmModelLabel('Sonnet 4.6')).toEqual({
      provider: 'anthropic-oauth',
      default: 'claude-sonnet-4-6',
    })
    expect(resolveSwarmModelLabel('Sonnet 4.5')).toEqual({
      provider: 'anthropic',
      default: 'claude-sonnet-4-5',
    })
  })

  it('resolves OpenAI Codex labels', () => {
    expect(resolveSwarmModelLabel('GPT-5.5')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.5',
    })
    expect(resolveSwarmModelLabel('GPT 5.4')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.4',
    })
    expect(resolveSwarmModelLabel('Codex (GPT-5.5)')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.5',
    })
  })

  it('resolves PC1 local labels regardless of TPS qualifier', () => {
    expect(resolveSwarmModelLabel('PC1 Coder (97 TPS)')).toEqual({
      provider: 'ollama-pc1',
      default: 'qwen3-coder-30b-fixed:latest',
    })
    expect(resolveSwarmModelLabel('PC1 Planner (175 TPS)')).toEqual({
      provider: 'ollama-pc1',
      default: 'pc1-planner:latest',
    })
    expect(resolveSwarmModelLabel('PC1 Critic')).toEqual({
      provider: 'ollama-pc1',
      default: 'pc1-critic:latest',
    })
  })

  it('passes through fully-qualified provider/model ids', () => {
    expect(resolveSwarmModelLabel('openai-codex/gpt-5.5')).toEqual({
      provider: 'openai-codex',
      default: 'gpt-5.5',
    })
    expect(resolveSwarmModelLabel('anthropic-oauth/claude-opus-4-7')).toEqual({
      provider: 'anthropic-oauth',
      default: 'claude-opus-4-7',
    })
  })

  it('returns null for unknown labels (so the worker is left alone)', () => {
    expect(resolveSwarmModelLabel('Unknown 9000')).toBeNull()
    expect(resolveSwarmModelLabel('typo opus')).toBeNull()
  })

  it('rejects shell/python metacharacters in slash-form ids', () => {
    // Defence-in-depth: even though the resolver only feeds yaml writes
    // today, an unconstrained slash regex would let a roster PATCH smuggle
    // newlines / quotes / shell ops downstream.
    expect(resolveSwarmModelLabel("evil/x'); os.system('id'); #")).toBeNull()
    expect(resolveSwarmModelLabel('evil/a"b')).toBeNull()
    expect(resolveSwarmModelLabel('evil/a\nb')).toBeNull()
    expect(resolveSwarmModelLabel('evil/a;b')).toBeNull()
    expect(resolveSwarmModelLabel('evil/$(whoami)')).toBeNull()
    expect(resolveSwarmModelLabel('../../etc/passwd')).toBeNull()
    expect(resolveSwarmModelLabel('UPPER/foo')).toBeNull() // provider must be lowercase-first
  })

  it('accepts the 7 Ollama Cloud bare ids', () => {
    for (const id of [
      'kimi-k2.6',
      'deepseek-v4-pro',
      'qwen3.5:397b',
      'qwen3-coder:480b',
      'glm-5.1',
      'deepseek-v4-flash',
      'gemma4:31b',
    ]) {
      expect(resolveSwarmModelLabel(id)).toEqual({
        provider: 'ollama-cloud',
        default: id,
      })
    }
  })
})
