import { requestOpenAICompatibleCompletion } from './openaiCompatibleClient.js';
import type { OpenAICompatibleMessage } from './openaiCompatible.js';

type EnvSource = Record<string, string | undefined>;

const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'gpt-4o-mini';
const DEFAULT_SURPRISE_TIMEOUT_MS = 12_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 350;
const DEFAULT_SURPRISE_MAX_RETRIES = 0;
const DEFAULT_SURPRISE_TEMPERATURE = 0.95;
const MAX_SURPRISE_PROMPT_CHARS = 420;

const SURPRISE_SYSTEM_PROMPT = `You create one fresh, high-quality user draft prompt.
Return only plain text without markdown, list markers, numbering, or code fences.
Language: Bahasa Indonesia.
The draft should be practical, specific, and ready to send to a prompt generator app.`;

interface ProviderConfig {
  apiKey?: string;
  model: string;
  url: string;
}

const FALLBACK_TOPICS = [
  'landing page platform donasi',
  'homepage SaaS produktivitas tim',
  'halaman campaign nonprofit',
  'website fintech onboarding',
  'landing page aplikasi edukasi',
  'halaman produk aplikasi kesehatan',
];

const FALLBACK_GOALS = [
  'meningkatkan konversi CTA utama',
  'memperjelas value proposition dalam 5 detik',
  'meningkatkan trust melalui bukti sosial',
  'mengurangi bounce rate di mobile',
  'meningkatkan registrasi pengguna baru',
  'memperkuat kualitas brief untuk tim desain',
];

const FALLBACK_CONSTRAINTS = [
  'mobile-first, aksesibilitas minimum WCAG, dan copy ringkas',
  'struktur heading semantik, CTA konsisten, dan no klaim palsu',
  'output deterministik, siap copy-paste, dan jelas lintas model',
  'dengan batasan performa, readability tinggi, dan trust element wajib',
  'pakai format terstruktur dengan quality criteria dan failure handling',
  'sertakan checklist UX, SEO dasar, dan fallback jika data kurang',
];

const readEnvValue = (envSource: EnvSource, key: string): string | undefined => {
  const rawValue = envSource[key] ?? process.env[key];
  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const trimmed = rawValue.trim();
  return trimmed || undefined;
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
  key: string,
  fallback: number
): number => {
  const raw = readEnvValue(envSource, key);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 0), 1);
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

export const sanitizeSurprisePromptOutput = (rawOutput: string): string => {
  let value = rawOutput
    .replace(/\r\n?/g, '\n')
    .replace(/^```[\w-]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .trim();

  if (!value) {
    return '';
  }

  value = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');

  value = value.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '');
  value = value.replace(/\s{2,}/g, ' ').trim();

  if (value.length > MAX_SURPRISE_PROMPT_CHARS) {
    value = `${value.slice(0, MAX_SURPRISE_PROMPT_CHARS - 1).trimEnd()}…`;
  }

  return value;
};

const pickRandom = <T>(values: T[]): T =>
  values[Math.floor(Math.random() * values.length)];

export const buildFallbackSurprisePrompt = (context?: string): string => {
  const topic = pickRandom(FALLBACK_TOPICS);
  const goal = pickRandom(FALLBACK_GOALS);
  const constraint = pickRandom(FALLBACK_CONSTRAINTS);
  const contextSuffix =
    context && context.trim()
      ? ` Gunakan konteks ini sebagai acuan: ${context.trim()}.`
      : '';

  return sanitizeSurprisePromptOutput(
    `Buatkan prompt detail untuk ${topic} dengan tujuan ${goal}; wajib ${constraint}.${contextSuffix}`
  );
};

export const generateSurprisePrompt = async ({
  envSource,
  context,
}: {
  envSource: EnvSource;
  context?: string;
}): Promise<string> => {
  const providerConfig = getOpenAICompatibleConfig(envSource);
  const timeoutMs = readPositiveIntegerEnv(
    envSource,
    'SURPRISE_TIMEOUT_MS',
    DEFAULT_SURPRISE_TIMEOUT_MS
  );
  const maxRetries = readPositiveIntegerEnv(
    envSource,
    'SURPRISE_MAX_RETRIES',
    DEFAULT_SURPRISE_MAX_RETRIES,
    0
  );
  const retryBaseDelayMs = readPositiveIntegerEnv(
    envSource,
    'OPENAI_COMPATIBLE_RETRY_BASE_DELAY_MS',
    DEFAULT_RETRY_BASE_DELAY_MS
  );
  const temperature = readFloatEnv(
    envSource,
    'SURPRISE_TEMPERATURE',
    DEFAULT_SURPRISE_TEMPERATURE
  );

  const userPrompt = [
    'Buat satu draft prompt user yang unik untuk kebutuhan prompt engineering.',
    'Draft harus konkret, bisa langsung dipakai, dan tidak memakai placeholder seperti [isi].',
    'Panjang 1-2 kalimat saja.',
    'Wajib sebut tujuan output dan minimal satu batasan kualitas.',
    context ? `Arah tema: ${context.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const messages: OpenAICompatibleMessage[] = [
    { role: 'system', content: SURPRISE_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const completion = await requestOpenAICompatibleCompletion({
    url: providerConfig.url,
    model: providerConfig.model,
    apiKey: providerConfig.apiKey,
    temperature,
    timeoutMs,
    maxRetries,
    retryBaseDelayMs,
    messages,
  });

  const prompt = sanitizeSurprisePromptOutput(completion);
  if (prompt.length < 12) {
    throw new Error('Model returned an invalid surprise prompt.');
  }

  return prompt;
};
