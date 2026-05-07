/**
 * Single source of truth for the Ollama Cloud model ids used by the Swarm
 * UI dropdown, the resolver passthrough, and the switch-model allowlist.
 *
 * Adding/removing a model only requires editing this file (plus any
 * runtime models.json on the VPS for the workspace picker).
 */

export const OLLAMA_CLOUD_IDS = [
  'kimi-k2.6',
  'deepseek-v4-pro',
  'qwen3.5:397b',
  'qwen3-coder:480b',
  'glm-5.1',
  'deepseek-v4-flash',
] as const

export type OllamaCloudId = (typeof OLLAMA_CLOUD_IDS)[number]

export function isOllamaCloudId(value: string): value is OllamaCloudId {
  const lower = value.toLowerCase()
  return OLLAMA_CLOUD_IDS.some((id) => id.toLowerCase() === lower)
}
