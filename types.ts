
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  id: string;
}

export const PROMPT_GENERATION_MODES = [
  'simple',
  'advanced',
  'expert',
] as const;

export type PromptGenerationMode = (typeof PROMPT_GENERATION_MODES)[number];

export const PROMPT_STABILITY_PROFILES = ['standard', 'strict'] as const;

export type PromptStabilityProfile =
  (typeof PROMPT_STABILITY_PROFILES)[number];

export const TARGET_AGENTS = [
  'universal',
  'chatgpt',
  'gemini',
  'claude-code',
  'kiro',
  'kimi',
] as const;

export type TargetAgent = (typeof TARGET_AGENTS)[number];

export interface PromptPattern {
  id: string;
  name: string;
  description: string;
  icon: string;
  template: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  GENERATING = 'GENERATING',
  ERROR = 'ERROR'
}
