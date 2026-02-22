import {
  REQUIRED_PROMPT_CONTRACT_ITEMS,
} from '../constants.js';
import type {
  PromptStabilityProfile,
  TargetAgent,
} from '../types.js';

const FINAL_PROMPT_HEADING = '## Final Prompt (Universal Core)';
const WHY_HEADING = '## Why This Prompt Is Powerful';
const CHECKLIST_HEADING = '## Prompt Contract Checklist';

const TARGET_AGENT_LABEL: Record<TargetAgent, string> = {
  universal: 'Universal',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  'claude-code': 'Claude Code',
  kiro: 'Kiro',
  kimi: 'Kimi',
};

const REPAIR_MODEL_SYSTEM_PROMPT = `You are a deterministic formatter.
Your only task is to rewrite the provided draft to satisfy the exact response schema.
Do not add new top-level sections beyond the required schema.
Keep wording concise, technical, and production-ready.`;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildAdapterHeading = (targetAgent: TargetAgent): string =>
  `## Adapter Block (Target: ${TARGET_AGENT_LABEL[targetAgent]})`;

const normalizeLineEndings = (value: string): string =>
  value.replace(/\r\n?/g, '\n');

const extractFinalPromptSection = (value: string): string => {
  const sectionMatch = value.match(
    /##\s*Final Prompt\s*\(Universal Core\)[\s\S]*?(?=\n##\s+[^\n]+|\s*$)/i
  );

  if (!sectionMatch) {
    return '';
  }

  return sectionMatch[0];
};

const extractCorePromptText = (value: string): string => {
  const finalPromptSection = extractFinalPromptSection(value);
  const codeBlockSource = finalPromptSection || value;
  const codeBlockMatch = codeBlockSource.match(/```(?:text|txt|markdown)?\n([\s\S]*?)```/i);

  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }

  return codeBlockSource.trim();
};

const truncate = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...[truncated]`;
};

export interface PromptOutputValidationResult {
  isValid: boolean;
  missingHeadings: string[];
  missingContractItems: string[];
  missingTextCodeBlock: boolean;
}

export const normalizeGeneratedPromptOutput = (
  rawOutput: string,
  targetAgent: TargetAgent
): string => {
  let output = normalizeLineEndings(rawOutput).trim();

  output = output
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  output = output.replace(
    /^#{1,3}\s*final prompt[^\n]*$/gim,
    FINAL_PROMPT_HEADING
  );
  output = output.replace(
    /^#{1,3}\s*(adapter block|target adapter|adapter)[^\n]*$/gim,
    buildAdapterHeading(targetAgent)
  );
  output = output.replace(
    /^#{1,3}\s*(why this prompt is powerful|why this prompt works|optimization notes)[^\n]*$/gim,
    WHY_HEADING
  );
  output = output.replace(
    /^#{1,3}\s*(prompt contract checklist|contract checklist|quality checklist)[^\n]*$/gim,
    CHECKLIST_HEADING
  );

  const adapterHeadingPattern = /^##\s*Adapter Block \(Target:\s*[^\n]+\)\s*$/im;
  if (adapterHeadingPattern.test(output)) {
    output = output.replace(
      adapterHeadingPattern,
      buildAdapterHeading(targetAgent)
    );
  }

  // Ensure the first code block under Final Prompt uses `text` fence.
  output = output.replace(
    /(##\s*Final Prompt\s*\(Universal Core\)\s*\n)```(?!text|txt|markdown)([^\n]*)\n/i,
    '$1```text\n'
  );

  return output.trim();
};

export const validateGeneratedPromptOutput = (
  output: string,
  targetAgent: TargetAgent
): PromptOutputValidationResult => {
  const requiredHeadings = [
    FINAL_PROMPT_HEADING,
    buildAdapterHeading(targetAgent),
    WHY_HEADING,
    CHECKLIST_HEADING,
  ];

  const missingHeadings = requiredHeadings.filter((heading) => {
    const headingRegex = new RegExp(
      `^${escapeRegExp(heading)}\\s*$`,
      'im'
    );
    return !headingRegex.test(output);
  });

  const finalPromptSection = extractFinalPromptSection(output);
  const codeBlockMatch = finalPromptSection.match(
    /```(?:text|txt|markdown)?\n([\s\S]*?)```/i
  );
  const missingTextCodeBlock = !codeBlockMatch;
  const promptBody = extractCorePromptText(output);

  const missingContractItems = [...REQUIRED_PROMPT_CONTRACT_ITEMS].filter(
    (item) => {
      const itemRegex = new RegExp(
        `(^|\\n)\\s*(?:[-*]|\\d+[.)])?\\s*${escapeRegExp(item)}\\s*:`,
        'i'
      );
      return !itemRegex.test(promptBody);
    }
  );

  return {
    isValid:
      missingHeadings.length === 0 &&
      missingContractItems.length === 0 &&
      !missingTextCodeBlock,
    missingHeadings,
    missingContractItems,
    missingTextCodeBlock,
  };
};

export const formatValidationIssues = (
  validation: PromptOutputValidationResult
): string => {
  const issues: string[] = [];
  if (validation.missingHeadings.length > 0) {
    issues.push(`Missing headings: ${validation.missingHeadings.join(', ')}`);
  }
  if (validation.missingContractItems.length > 0) {
    issues.push(
      `Missing prompt contract labels: ${validation.missingContractItems.join(', ')}`
    );
  }
  if (validation.missingTextCodeBlock) {
    issues.push(
      'Final Prompt section must include a fenced code block using ```text.'
    );
  }

  return issues.join('\n');
};

export const buildRepairInstruction = ({
  targetAgent,
  stabilityProfile,
  originalOutput,
  validation,
}: {
  targetAgent: TargetAgent;
  stabilityProfile: PromptStabilityProfile;
  originalOutput: string;
  validation: PromptOutputValidationResult;
}): { system: string; user: string } => {
  const schema = [
    FINAL_PROMPT_HEADING,
    buildAdapterHeading(targetAgent),
    WHY_HEADING,
    CHECKLIST_HEADING,
  ].join('\n');

  const user = [
    `Stability profile: ${stabilityProfile}.`,
    'Rewrite the draft so it strictly matches the schema below.',
    'Keep the intent and quality, but make format deterministic and compact.',
    '',
    'Required schema (exact headings and order):',
    schema,
    '',
    'Prompt contract labels that MUST exist inside the Final Prompt code block:',
    [...REQUIRED_PROMPT_CONTRACT_ITEMS].join(', '),
    '',
    'Detected issues to fix:',
    formatValidationIssues(validation) || 'No issues listed.',
    '',
    'Draft to repair:',
    '```markdown',
    truncate(originalOutput, 12000),
    '```',
  ].join('\n');

  return {
    system: REPAIR_MODEL_SYSTEM_PROMPT,
    user,
  };
};

export const buildFallbackCanonicalOutput = ({
  draftOutput,
  userRequest,
  targetAgent,
}: {
  draftOutput: string;
  userRequest: string;
  targetAgent: TargetAgent;
}): string => {
  const draftCore = truncate(extractCorePromptText(draftOutput), 6000);
  const safeDraftCore = draftCore.replace(/```/g, '``\\`');
  const conciseUserRequest = truncate(userRequest.trim() || 'General user request', 500);

  return [
    FINAL_PROMPT_HEADING,
    '```text',
    'Role: Senior Prompt Engineer for cross-model reliability.',
    `Objective: Transform user intent into a production-ready prompt artifact. (${conciseUserRequest})`,
    'Context: Multi-provider usage (Gemini, Claude Code, Kiro, Kimi, and OpenAI-compatible models).',
    'Constraints: Keep output deterministic, portable, concise, and low-ambiguity; avoid provider-only syntax.',
    'Output Format: Return structured markdown sections exactly as required by schema.',
    'Quality Criteria: Clarity, completeness, transferability, measurable constraints, and low hallucination risk.',
    'Failure Handling: If context is missing, ask explicit follow-up questions before final assumptions.',
    '',
    'Draft Context (for refinement):',
    safeDraftCore || 'No draft content available.',
    '```',
    buildAdapterHeading(targetAgent),
    '```text',
    'Apply only target-specific tuning while preserving the universal core contract.',
    'Do not remove required sections or labels.',
    '```',
    WHY_HEADING,
    '- Enforces a deterministic schema across providers.',
    '- Preserves role/objective/constraints to reduce ambiguity.',
    '- Adds explicit failure handling for missing context.',
    CHECKLIST_HEADING,
    '- Role: Yes',
    '- Objective: Yes',
    '- Context: Yes',
    '- Constraints: Yes',
    '- Output Format: Yes',
    '- Quality Criteria: Yes',
    '- Failure Handling: Yes',
  ].join('\n');
};

export const splitIntoStreamChunks = (
  output: string,
  chunkSize: number = 700
): string[] => {
  const normalizedOutput = output || '';
  if (!normalizedOutput) {
    return [''];
  }

  const chunks: string[] = [];
  for (let index = 0; index < normalizedOutput.length; index += chunkSize) {
    chunks.push(normalizedOutput.slice(index, index + chunkSize));
  }

  return chunks;
};

export const resolveStabilityProfile = ({
  requested,
  fallback,
}: {
  requested?: PromptStabilityProfile;
  fallback?: PromptStabilityProfile;
}): PromptStabilityProfile => {
  if (requested === 'strict' || requested === 'standard') {
    return requested;
  }

  return fallback === 'strict' ? 'strict' : 'standard';
};
