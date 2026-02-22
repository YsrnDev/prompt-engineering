import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFallbackCanonicalOutput,
  normalizeGeneratedPromptOutput,
  splitIntoStreamChunks,
  validateGeneratedPromptOutput,
} from '../lib/promptStability.js';

const modelVariantOutput = `### Final Prompt
\`\`\`
Role: Senior Prompt Engineer
Objective: Build a strong prompt
Context: Donation landing page
Constraints: Keep clear sections
Output Format: markdown
Quality Criteria: conversion-focused and readable
Failure Handling: ask follow-up questions when needed
\`\`\`
### Adapter
\`\`\`text
Use concise style for Gemini.
\`\`\`
### Optimization Notes
- Structured for production.
- Deterministic sections.
- Transferable format.
### Quality Checklist
- Role: Yes
- Objective: Yes
- Context: Yes
- Constraints: Yes
- Output Format: Yes
- Quality Criteria: Yes
- Failure Handling: Yes`;

test('normalizeGeneratedPromptOutput canonicalizes variant headings', () => {
  const normalized = normalizeGeneratedPromptOutput(
    modelVariantOutput,
    'gemini'
  );

  assert.match(
    normalized,
    /^## Final Prompt \(Universal Core\)/m
  );
  assert.match(
    normalized,
    /^## Adapter Block \(Target: Gemini\)/m
  );
  assert.match(
    normalized,
    /^## Why This Prompt Is Powerful/m
  );
  assert.match(
    normalized,
    /^## Prompt Contract Checklist/m
  );
});

test('validateGeneratedPromptOutput detects missing sections', () => {
  const invalidOutput = `## Final Prompt (Universal Core)
\`\`\`text
Role: Prompt Engineer
Objective: Build a prompt
Context: Generic context
Constraints: Keep clear
Output Format: markdown
Quality Criteria: readable
\`\`\``;

  const validation = validateGeneratedPromptOutput(
    invalidOutput,
    'universal'
  );

  assert.equal(validation.isValid, false);
  assert.ok(validation.missingHeadings.length > 0);
  assert.ok(validation.missingContractItems.includes('Failure Handling'));
});

test('buildFallbackCanonicalOutput always satisfies required schema', () => {
  const fallback = buildFallbackCanonicalOutput({
    draftOutput: 'raw draft response without structure',
    userRequest: 'Buatkan prompt landing page donasi',
    targetAgent: 'claude-code',
  });

  const validation = validateGeneratedPromptOutput(
    fallback,
    'claude-code'
  );

  assert.equal(validation.isValid, true);
});

test('splitIntoStreamChunks chunks output deterministically', () => {
  const chunks = splitIntoStreamChunks('abcdefghij', 3);
  assert.deepEqual(chunks, ['abc', 'def', 'ghi', 'j']);
});
