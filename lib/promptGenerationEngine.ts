import {
  buildPromptGeneratorInstruction,
  DEFAULT_PROMPT_MODE,
  DEFAULT_PROMPT_STABILITY_PROFILE,
  DEFAULT_TARGET_AGENT,
} from '../constants.js';
import type { GenerateRequestPayload } from './chatShared.js';
import {
  toOpenAICompatibleMessages,
  type OpenAICompatibleMessage,
} from './openaiCompatible.js';
import { requestOpenAICompatibleCompletion } from './openaiCompatibleClient.js';
import {
  buildFallbackCanonicalOutput,
  buildRepairInstruction,
  normalizeGeneratedPromptOutput,
  resolveStabilityProfile,
  validateGeneratedPromptOutput,
  type PromptOutputValidationResult,
} from './promptStability.js';
import type {
  Message,
  PromptGenerationMode,
  PromptStabilityProfile,
  TargetAgent,
} from '../types.js';

type EnvSource = Record<string, string | undefined>;

interface ProviderConfig {
  apiKey?: string;
  model: string;
  url: string;
}

export interface GeneratePromptArtifactResult {
  output: string;
  stabilityProfile: PromptStabilityProfile;
  repaired: boolean;
  validation: PromptOutputValidationResult;
}

const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_TIMEOUT_MS = 45_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 350;
const DEFAULT_MAX_RETRIES = 1;

const MODE_TEMPERATURE: Record<PromptGenerationMode, number> = {
  simple: 0.22,
  advanced: 0.28,
  expert: 0.34,
};

const readEnvValue = (envSource: EnvSource, key: string): string | undefined => {
  const rawValue = envSource[key] ?? process.env[key];
  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const trimmed = rawValue.trim();
  return trimmed || undefined;
};

const isTruthy = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const readPositiveIntegerEnv = (
  envSource: EnvSource,
  key: string,
  fallback: number,
  minValue: number = 1
): number => {
  const raw = readEnvValue(envSource, key);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallback;
  }

  return parsed;
};

const readFloatEnv = (
  envSource: EnvSource,
  key: string
): number | undefined => {
  const raw = readEnvValue(envSource, key);
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
};

const clampTemperature = (value: number): number =>
  Math.min(Math.max(value, 0), 1);

const resolveTemperature = ({
  envSource,
  mode,
  stabilityProfile,
}: {
  envSource: EnvSource;
  mode: PromptGenerationMode;
  stabilityProfile: PromptStabilityProfile;
}): number => {
  const explicit = readFloatEnv(envSource, 'OPENAI_COMPATIBLE_TEMPERATURE');
  if (explicit !== undefined) {
    return clampTemperature(explicit);
  }

  const base = MODE_TEMPERATURE[mode];
  if (stabilityProfile === 'strict') {
    return clampTemperature(base - 0.1);
  }

  return clampTemperature(base);
};

const getOpenAICompatibleConfig = (envSource: EnvSource): ProviderConfig => {
  const directUrl = readEnvValue(envSource, 'OPENAI_COMPATIBLE_URL');
  const baseUrl = readEnvValue(envSource, 'OPENAI_COMPATIBLE_BASE_URL');

  if (!directUrl && !baseUrl) {
    throw new Error(
      'Missing OPENAI_COMPATIBLE_URL or OPENAI_COMPATIBLE_BASE_URL.'
    );
  }

  const normalizedBase = baseUrl?.replace(/\/+$/, '');
  const url =
    directUrl ||
    (normalizedBase?.endsWith('/v1/chat/completions')
      ? normalizedBase
      : `${normalizedBase}/v1/chat/completions`);

  const apiKey =
    readEnvValue(envSource, 'OPENAI_COMPATIBLE_API_KEY') ||
    readEnvValue(envSource, 'OPENAI_API_KEY');

  return {
    apiKey,
    model:
      readEnvValue(envSource, 'OPENAI_COMPATIBLE_MODEL') ||
      readEnvValue(envSource, 'OPENAI_MODEL') ||
      DEFAULT_OPENAI_COMPATIBLE_MODEL,
    url,
  };
};

const getLastUserMessage = (messages: Message[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return messages[index].content.trim();
    }
  }

  return '';
};

const getDefaultStabilityProfileFromEnv = (
  envSource: EnvSource
): PromptStabilityProfile => {
  const configured = readEnvValue(envSource, 'PROMPT_STABILITY_PROFILE');
  if (configured === 'strict' || configured === 'standard') {
    return configured;
  }

  if (isTruthy(readEnvValue(envSource, 'PROMPT_FORCE_STRICT_MODE'))) {
    return 'strict';
  }

  return DEFAULT_PROMPT_STABILITY_PROFILE;
};

const shouldUseAutoRepair = (envSource: EnvSource): boolean =>
  !isTruthy(readEnvValue(envSource, 'PROMPT_AUTO_REPAIR_DISABLE'));

export const generatePromptArtifact = async ({
  envSource,
  payload,
  contextMessages,
  skillInstruction,
}: {
  envSource: EnvSource;
  payload: GenerateRequestPayload;
  contextMessages: Message[];
  skillInstruction: string;
}): Promise<GeneratePromptArtifactResult> => {
  const providerConfig = getOpenAICompatibleConfig(envSource);
  const mode = payload.mode ?? DEFAULT_PROMPT_MODE;
  const targetAgent = payload.targetAgent ?? DEFAULT_TARGET_AGENT;
  const stabilityProfile = resolveStabilityProfile({
    requested: payload.stabilityProfile,
    fallback: getDefaultStabilityProfileFromEnv(envSource),
  });

  const timeoutMs = readPositiveIntegerEnv(
    envSource,
    'OPENAI_COMPATIBLE_TIMEOUT_MS',
    DEFAULT_OPENAI_TIMEOUT_MS
  );
  const maxRetries = readPositiveIntegerEnv(
    envSource,
    'OPENAI_COMPATIBLE_MAX_RETRIES',
    DEFAULT_MAX_RETRIES,
    0
  );
  const retryBaseDelayMs = readPositiveIntegerEnv(
    envSource,
    'OPENAI_COMPATIBLE_RETRY_BASE_DELAY_MS',
    DEFAULT_RETRY_BASE_DELAY_MS
  );
  const temperature = resolveTemperature({
    envSource,
    mode,
    stabilityProfile,
  });

  const systemInstruction = [
    buildPromptGeneratorInstruction(mode, targetAgent, { stabilityProfile }),
    skillInstruction,
  ]
    .filter(Boolean)
    .join('\n\n');

  const baseMessages = toOpenAICompatibleMessages(
    contextMessages,
    systemInstruction
  );

  let output = await requestOpenAICompatibleCompletion({
    url: providerConfig.url,
    model: providerConfig.model,
    apiKey: providerConfig.apiKey,
    temperature,
    timeoutMs,
    maxRetries,
    retryBaseDelayMs,
    messages: baseMessages,
  });

  output = normalizeGeneratedPromptOutput(output, targetAgent);
  let validation = validateGeneratedPromptOutput(output, targetAgent);
  let repaired = false;

  if (!validation.isValid && shouldUseAutoRepair(envSource)) {
    const repair = buildRepairInstruction({
      targetAgent,
      stabilityProfile,
      originalOutput: output,
      validation,
    });

    const repairMessages: OpenAICompatibleMessage[] = [
      { role: 'system', content: repair.system },
      { role: 'user', content: repair.user },
    ];

    try {
      const repairedOutput = await requestOpenAICompatibleCompletion({
        url: providerConfig.url,
        model: providerConfig.model,
        apiKey: providerConfig.apiKey,
        temperature: clampTemperature(Math.min(temperature, 0.15)),
        timeoutMs,
        maxRetries,
        retryBaseDelayMs,
        messages: repairMessages,
      });

      output = normalizeGeneratedPromptOutput(repairedOutput, targetAgent);
      validation = validateGeneratedPromptOutput(output, targetAgent);
      repaired = true;
    } catch {
      // Keep original output and fall back to canonical template below if still invalid.
    }
  }

  if (!validation.isValid) {
    output = normalizeGeneratedPromptOutput(
      buildFallbackCanonicalOutput({
        draftOutput: output,
        userRequest: getLastUserMessage(contextMessages),
        targetAgent,
      }),
      targetAgent
    );
    validation = validateGeneratedPromptOutput(output, targetAgent);
  }

  return {
    output,
    stabilityProfile,
    repaired,
    validation,
  };
};
