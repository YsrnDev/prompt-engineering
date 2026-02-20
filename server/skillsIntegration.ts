import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Message } from '../types.js';

type EnvSource = Record<string, string | undefined>;

export interface SkillStatus {
  id: string;
  name: string;
  loaded: boolean;
  source?: string;
  bytes: number;
  error?: string;
  updatedAt: string;
}

interface SkillDefinition {
  id: string;
  name: string;
  envRefKey: string;
  defaultRefs: string[];
  when: 'always' | 'ui-ux';
}

interface SkillCache {
  expiresAt: number;
  statuses: SkillStatus[];
  instructionsById: Record<string, string>;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_SKILL_CHARS = 12000;
const SKILLS_STATUS_ROUTE = '/api/skills-status';

const SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    id: 'prompt-engineering-pattern',
    name: 'Prompt Engineering Pattern',
    envRefKey: 'SKILLS_SH_PROMPT_ENGINEERING_PATTERN_REF',
    defaultRefs: ['prompt-engineering-pattern', 'prompt-engineering-patterns'],
    when: 'always',
  },
  {
    id: 'ui-ux-pro-max',
    name: 'UI UX Pro Max',
    envRefKey: 'SKILLS_SH_UI_UX_PRO_MAX_REF',
    defaultRefs: ['ui-ux-pro-max', 'ui-ux-pro-max-skill'],
    when: 'ui-ux',
  },
];

const UI_UX_INTENT_REGEX =
  /\b(landing page|landingpage|ui|ux|design|desain|website|web app|homepage|hero|cta|layout|wireframe|mockup|responsive|responsif)\b/i;

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

const clampSkillContent = (content: string): string =>
  content.length > MAX_SKILL_CHARS
    ? `${content.slice(0, MAX_SKILL_CHARS)}\n...[truncated]`
    : content;

const isLikelyUrl = (value: string): boolean => /^https?:\/\//i.test(value);
const looksLikeHtmlDocument = (value: string): boolean =>
  /<!doctype html|<html\b|<body\b/i.test(value);

const getLocalSkillRoots = (): string[] => {
  const home = os.homedir();
  return [
    path.join(process.cwd(), 'skills'),
    path.join(process.cwd(), '.skills'),
    path.join(home, '.agents', 'skills'),
    path.join(home, '.codex', 'skills'),
    path.join(home, '.codex', 'vendor_imports', 'skills', 'skills', '.curated'),
  ];
};

const toCandidateSkillFiles = (basePath: string): string[] => {
  const normalized = basePath.replace(/^file:\/\//i, '');
  return [
    normalized,
    path.join(normalized, 'SKILL.md'),
    path.join(normalized, 'skill.md'),
    path.join(normalized, 'README.md'),
  ];
};

const readFirstExistingFile = async (
  candidates: string[]
): Promise<{ content: string; source: string } | null> => {
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) {
        continue;
      }

      const content = await fs.readFile(candidate, 'utf8');
      return { content, source: candidate };
    } catch {
      // Try next candidate.
    }
  }

  return null;
};

const findSkillFileByName = async (
  name: string
): Promise<{ content: string; source: string } | null> => {
  const roots = getLocalSkillRoots();

  for (const root of roots) {
    const direct = await readFirstExistingFile(
      toCandidateSkillFiles(path.join(root, name))
    );
    if (direct) {
      return direct;
    }

    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const normalizedNeedle = name.toLowerCase().replace(/[^a-z0-9]/g, '');

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const normalizedEntry = entry.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (
          !normalizedEntry.includes(normalizedNeedle) &&
          !normalizedNeedle.includes(normalizedEntry)
        ) {
          continue;
        }

        const maybe = await readFirstExistingFile(
          toCandidateSkillFiles(path.join(root, entry.name))
        );
        if (maybe) {
          return maybe;
        }
      }
    } catch {
      // Root might not exist or be inaccessible.
    }
  }

  return null;
};

const decodeHtmlEntities = (value: string): string =>
  value.replace(
    /&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi,
    (_match, entity: string) => {
      const normalized = entity.toLowerCase();

      if (normalized === 'amp') {
        return '&';
      }
      if (normalized === 'lt') {
        return '<';
      }
      if (normalized === 'gt') {
        return '>';
      }
      if (normalized === 'quot') {
        return '"';
      }
      if (normalized === 'apos') {
        return "'";
      }
      if (normalized === 'nbsp') {
        return ' ';
      }

      if (normalized.startsWith('#x')) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
      }

      if (normalized.startsWith('#')) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
      }

      return '';
    }
  );

const stripHtmlToText = (html: string): string =>
  decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

const extractSkillSectionFromText = (value: string): string => {
  const titleMatch = /(?:^|\n)\s*SKILL\.md\s*(?:\n|$)/i.exec(value);
  if (!titleMatch || titleMatch.index === undefined) {
    return value.trim();
  }

  const startIndex = titleMatch.index + titleMatch[0].length;
  const body = value.slice(startIndex).trimStart();
  if (!body) {
    return value.trim();
  }

  const stopMarkers = [
    /(?:^|\n)\s*Weekly Installs\b/i,
    /(?:^|\n)\s*Repository\b/i,
    /(?:^|\n)\s*First Seen\b/i,
    /(?:^|\n)\s*Installed on\b/i,
    /(?:^|\n)\s*Similar Skills\b/i,
    /(?:^|\n)\s*Recent Installs\b/i,
    /(?:^|\n)\s*Related Skills\b/i,
  ];

  let stopAt = body.length;
  for (const marker of stopMarkers) {
    const markerMatch = marker.exec(body);
    if (markerMatch && markerMatch.index < stopAt) {
      stopAt = markerMatch.index;
    }
  }

  return body.slice(0, stopAt).trim();
};

const normalizeFetchedSkillContent = (rawContent: string): string => {
  const trimmed = rawContent.trim();
  if (!trimmed) {
    return '';
  }

  if (!looksLikeHtmlDocument(trimmed)) {
    return trimmed;
  }

  const pageText = stripHtmlToText(trimmed);
  if (!pageText) {
    return '';
  }

  return extractSkillSectionFromText(pageText);
};

const fetchSkillFromUrl = async (
  url: string
): Promise<{ content: string; source: string } | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }

    const rawContent = await response.text();
    const content = normalizeFetchedSkillContent(rawContent);
    if (!content) {
      return null;
    }

    return { content, source: url };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const getLastUserMessageContent = (messages: Message[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return messages[index].content;
    }
  }

  return '';
};

export class SkillsIntegration {
  private readonly envSource: EnvSource;
  private cache: SkillCache | null = null;
  private readonly enabled: boolean;

  constructor(envSource: EnvSource) {
    this.envSource = envSource;
    this.enabled = !isTruthy(readEnvValue(envSource, 'SKILLS_SH_DISABLE'));
  }

  private async loadOneSkill(definition: SkillDefinition): Promise<{
    status: SkillStatus;
    instruction?: string;
  }> {
    const configuredRef = readEnvValue(this.envSource, definition.envRefKey);
    const refsToTry = configuredRef
      ? [configuredRef]
      : definition.defaultRefs;
    const probeErrors: string[] = [];

    for (const ref of refsToTry) {
      let resolved: { content: string; source: string } | null = null;

      if (isLikelyUrl(ref)) {
        resolved = await fetchSkillFromUrl(ref);
        if (!resolved) {
          probeErrors.push(`Failed to load URL: ${ref}`);
        }
      } else {
        resolved =
          (await readFirstExistingFile(toCandidateSkillFiles(ref))) ||
          (await findSkillFileByName(ref));
        if (!resolved) {
          probeErrors.push(`Local reference not found: ${ref}`);
        }
      }

      if (!resolved) {
        continue;
      }

      const instruction = clampSkillContent(resolved.content.trim());
      return {
        status: {
          id: definition.id,
          name: definition.name,
          loaded: true,
          source: resolved.source,
          bytes: Buffer.byteLength(instruction, 'utf8'),
          updatedAt: new Date().toISOString(),
        },
        instruction,
      };
    }

    return {
      status: {
        id: definition.id,
        name: definition.name,
        loaded: false,
        bytes: 0,
        error:
          probeErrors.length > 0
            ? probeErrors.join(' | ')
            : 'Skill reference not found (local file/path/URL).',
        updatedAt: new Date().toISOString(),
      },
    };
  }

  private async refreshCache(): Promise<SkillCache> {
    if (!this.enabled) {
      return {
        expiresAt: Date.now() + CACHE_TTL_MS,
        statuses: SKILL_DEFINITIONS.map((definition) => ({
          id: definition.id,
          name: definition.name,
          loaded: false,
          bytes: 0,
          error: 'Skills integration disabled by SKILLS_SH_DISABLE.',
          updatedAt: new Date().toISOString(),
        })),
        instructionsById: {},
      };
    }

    const entries = await Promise.all(
      SKILL_DEFINITIONS.map(async (definition) => {
        const loaded = await this.loadOneSkill(definition);
        return {
          definition,
          status: loaded.status,
          instruction: loaded.instruction,
        };
      })
    );

    const instructionsById: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.instruction) {
        instructionsById[entry.definition.id] = entry.instruction;
      }
    }

    return {
      expiresAt: Date.now() + CACHE_TTL_MS,
      statuses: entries.map((entry) => entry.status),
      instructionsById,
    };
  }

  private async getCache(): Promise<SkillCache> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache;
    }

    this.cache = await this.refreshCache();
    return this.cache;
  }

  async getStatus(): Promise<{ enabled: boolean; skills: SkillStatus[] }> {
    const cache = await this.getCache();
    return {
      enabled: this.enabled,
      skills: cache.statuses,
    };
  }

  async buildInstructionForRequest(messages: Message[]): Promise<string> {
    const cache = await this.getCache();
    const latestUserContent = getLastUserMessageContent(messages);
    const hasUiUxIntent = UI_UX_INTENT_REGEX.test(latestUserContent);
    const blocks: string[] = [];

    for (const definition of SKILL_DEFINITIONS) {
      const instruction = cache.instructionsById[definition.id];
      if (!instruction) {
        continue;
      }

      if (definition.when === 'ui-ux' && !hasUiUxIntent) {
        continue;
      }

      blocks.push(`[Skill: ${definition.name}]\n${instruction}`);
    }

    if (blocks.length === 0) {
      return '';
    }

    return [
      'SKILLS.SH CONTEXT:',
      'Use the following skill instructions as high-priority guidance when crafting the response.',
      blocks.join('\n\n'),
    ].join('\n\n');
  }
}

export const createSkillsIntegration = (envSource: EnvSource): SkillsIntegration =>
  new SkillsIntegration(envSource);

export { SKILLS_STATUS_ROUTE };
