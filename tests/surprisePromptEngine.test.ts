import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFallbackSurprisePrompt,
  sanitizeSurprisePromptOutput,
} from '../lib/surprisePromptEngine.js';

test('sanitizeSurprisePromptOutput removes markdown wrappers and bullets', () => {
  const input = `\`\`\`text
- Buatkan prompt detail untuk landing page donasi dengan CTA kuat dan trust section.
\`\`\``;

  const output = sanitizeSurprisePromptOutput(input);
  assert.equal(
    output,
    'Buatkan prompt detail untuk landing page donasi dengan CTA kuat dan trust section.'
  );
});

test('sanitizeSurprisePromptOutput collapses multiline output into one line', () => {
  const input = `1) Buatkan prompt untuk website edukasi.
Tambahkan batasan performa dan aksesibilitas.
`;

  const output = sanitizeSurprisePromptOutput(input);
  assert.equal(
    output,
    'Buatkan prompt untuk website edukasi. Tambahkan batasan performa dan aksesibilitas.'
  );
});

test('sanitizeSurprisePromptOutput truncates overly long output', () => {
  const input = `Buatkan prompt ${'x'.repeat(900)}`;
  const output = sanitizeSurprisePromptOutput(input);
  assert.ok(output.length <= 420);
});

test('buildFallbackSurprisePrompt returns usable prompt', () => {
  const output = buildFallbackSurprisePrompt('fokus donasi pendidikan');
  assert.ok(output.includes('fokus donasi pendidikan'));
  assert.ok(output.length >= 20);
});
