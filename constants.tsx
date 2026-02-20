import {
  PromptPattern,
  type PromptGenerationMode,
  type TargetAgent,
} from './types';

export const PROMPT_PATTERNS: PromptPattern[] = [
  {
    id: 'persona',
    name: 'Persona Pattern',
    description: 'Assign a specific role or expert identity to the AI.',
    icon: '\u{1F464}',
    template: 'Act as a [Role]. You have expertise in [Domain]. Your goal is to [Goal].'
  },
  {
    id: 'cot',
    name: 'Chain of Thought',
    description: 'Encourage step-by-step reasoning for complex tasks.',
    icon: '\u{1F9E0}',
    template: 'Let\'s think about this step by step. First, [Step 1]. Then, [Step 2]. Finally, [Conclusion].'
  },
  {
    id: 'few-shot',
    name: 'Few-Shot Learning',
    description: 'Provide examples of input and output to guide the model.',
    icon: '\u{1F4DD}',
    template: 'Example 1: [Input] -> [Output]\nExample 2: [Input] -> [Output]\nNow, process this: [Target Input]'
  },
  {
    id: 'critique',
    name: 'Self-Critique',
    description: 'Ask the AI to evaluate its own response and improve it.',
    icon: '\u2696\uFE0F',
    template: 'Review your previous response. Identify 3 weaknesses and rewrite it to be more [Adjective].'
  },
  {
    id: 'delimiter',
    name: 'Delimiters',
    description: 'Use clear markers like triple backticks or XML tags to separate sections.',
    icon: '\u{1F517}',
    template: 'Use the text provided within the <context> tags to answer the question: <context>[Text]</context>'
  }
];

export const SURPRISE_PROMPTS_PATTERN_FIXED: string[] = [
  'Act as a senior prompt engineer for product teams. Create a production-ready prompt that asks an AI to design a donation platform landing page with a clear value proposition, trust-building sections, and two conversion-focused call-to-actions.',
  'Think step by step to turn a basic request into a high-quality prompt for building a donation platform homepage. Break the work into objective, audience, sections, style direction, and success criteria.',
  'Example 1 Input: Build a startup landing page. Example 1 Output: A structured prompt with role, objective, constraints, and measurable success metrics. Example 2 Input: Build a portfolio page. Example 2 Output: A structured prompt with clear sections and conversion goals. Now transform this request into the same quality prompt: Build a donation platform landing page.',
  'Generate an initial prompt for creating a donation platform landing page, then self-critique it by listing three weaknesses and rewrite it into a stronger final prompt with better clarity, constraints, and output format.',
  'Use the context inside the following tags to generate a final prompt for an AI web builder. <context>Product is a donation platform. Audience is first-time and recurring donors. Main goals are trust, transparency, and conversion. Tone should be human, warm, and professional.</context>',
];

export const SURPRISE_PROMPTS_FREEFORM: string[] = [
  'Create a detailed prompt to design a modern SaaS landing page for a team productivity app with strong messaging hierarchy, social proof, and a clear free-trial flow.',
  'Write a complete AI prompt that generates a mobile-first homepage for an online learning platform, including hero copy, curriculum highlights, testimonials, pricing teaser, and final call to action.',
  'Build a high-converting prompt for a fintech app website that emphasizes security, speed, and trust, with section-by-section goals and clear microcopy guidance.',
  'Generate a structured prompt for creating a portfolio website for a UI designer, including project storytelling, case-study layout, and contact conversion strategy.',
  'Produce an expert-level prompt for an AI agent to craft a product launch landing page with launch narrative, feature breakdown, objection handling, and urgency-based call to action.',
];

export const SYSTEM_INSTRUCTION = `You are "Prompt Architect AI", a world-class senior Prompt Engineer and LLM Optimization expert.
Your goal is to help users create, refine, and perfect their prompts using advanced patterns.

CORE CAPABILITIES:
1. Transform simple requests into high-performance, structured prompts.
2. Suggest relevant patterns (Persona, Chain-of-Thought, Few-Shot, etc.).
3. Critique existing prompts for ambiguity and hallucinations.
4. Output prompts in clear, copy-pasteable blocks.

RESPONSE GUIDELINES:
- Always be professional, insightful, and technical.
- When generating a prompt, provide:
  - **Proposed Prompt**: The actual text to use.
  - **Engineering Logic**: Which patterns you used and why.
  - **Optimization Tips**: How to tweak it further.
- Use Markdown for structure. Use code blocks for the prompt itself.
- Ensure visual elegance in your responses.`;

export const DEFAULT_PROMPT_MODE: PromptGenerationMode = 'advanced';
export const DEFAULT_TARGET_AGENT: TargetAgent = 'universal';

export const PROMPT_MODE_OPTIONS: Array<{
  value: PromptGenerationMode;
  label: string;
}> = [
  { value: 'simple', label: 'Simple' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
];

export const TARGET_AGENT_OPTIONS: Array<{
  value: TargetAgent;
  label: string;
}> = [
  { value: 'universal', label: 'Universal' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'kiro', label: 'Kiro' },
  { value: 'kimi', label: 'Kimi' },
];

const MODE_INSTRUCTION_SUFFIX: Record<PromptGenerationMode, string> = {
  simple: `MODE: SIMPLE
- Produce concise, practical prompts for quick use.
- Keep explanations short and avoid deep technical jargon.
- Provide only essential prompt scaffolding.`,
  advanced: `MODE: ADVANCED
- Produce balanced prompts with structure + rationale.
- Include relevant pattern choices and moderate optimization detail.
- Keep output clear for daily professional use.`,
  expert: `MODE: EXPERT
- Produce highly optimized prompts with strict constraints and evaluation criteria.
- Include advanced techniques (role layering, delimiters, few-shot scaffolding, risk controls).
- Add rigorous optimization notes suitable for power users.`,
};

export const buildSystemInstructionForMode = (
  mode: PromptGenerationMode
): string => `${SYSTEM_INSTRUCTION}\n\n${MODE_INSTRUCTION_SUFFIX[mode]}`;

const TARGET_AGENT_ADAPTER: Record<TargetAgent, string> = {
  universal: `TARGET AGENT PROFILE: UNIVERSAL
- Keep syntax provider-neutral and portable.
- Avoid platform-specific parameters and unsupported keywords.
- Use plain sections and explicit constraints only.`,
  gemini: `TARGET AGENT PROFILE: GEMINI
- Write concise, direct instructions with explicit task boundaries.
- Prefer markdown sections and clear success criteria.
- Keep context chunks structured and easy to scan.`,
  'claude-code': `TARGET AGENT PROFILE: CLAUDE CODE
- Prioritize implementation realism and deterministic coding constraints.
- Require explicit files, commands, and validation steps when coding is requested.
- Push for defensive assumptions and edge-case handling.`,
  kiro: `TARGET AGENT PROFILE: KIRO
- Use clear goal decomposition and workflow-first directives.
- Prefer concise staged instructions and concrete deliverable checklists.
- Keep outputs optimization-focused and execution-ready.`,
  kimi: `TARGET AGENT PROFILE: KIMI
- Favor high-context reasoning prompts with explicit role + objective framing.
- Keep prompt language crisp, with step-by-step directives for reliability.
- Add strict output formatting and evaluation checkpoints.`,
};

const PROMPT_CONTRACT_TEMPLATE = `PROMPT CONTRACT (must be enforced in generated prompt):
1) Role
2) Objective
3) Context
4) Constraints
5) Output Format
6) Quality Criteria
7) Failure Handling`;

const MULTI_PASS_TEMPLATE = `INTERNAL MULTI-PASS PIPELINE (do internally before final answer):
Pass 1: Expand the user intent into a concrete target outcome.
Pass 2: Add hard constraints, scope boundaries, and assumptions.
Pass 3: Add acceptance criteria, quality rubric, and validation checks.
Pass 4: Add risk controls (ambiguity, hallucination, missing data handling).
Pass 5: Rewrite into one copy-ready, high-leverage prompt for the target agent.`;

const RESPONSE_FORMAT_TEMPLATE = `RESPONSE FORMAT (required):
## Final Prompt (Universal Core)
\`\`\`text
[full prompt]
\`\`\`
## Adapter Block (Target: [AgentName])
\`\`\`text
[target-agent-specific adjustments only]
\`\`\`
## Why This Prompt Is Powerful
- [short bullet]
- [short bullet]
- [short bullet]`;

export const buildPromptGeneratorInstruction = (
  mode: PromptGenerationMode,
  targetAgent: TargetAgent
): string =>
  [
    buildSystemInstructionForMode(mode),
    'TASK TYPE: Prompt Generator. Convert the user request into a highly detailed, production-ready prompt for another AI agent.',
    MULTI_PASS_TEMPLATE,
    PROMPT_CONTRACT_TEMPLATE,
    TARGET_AGENT_ADAPTER[targetAgent],
    RESPONSE_FORMAT_TEMPLATE,
    'IMPORTANT: Do not output implementation/code unless the user explicitly asks for code. Primary output is the prompt artifact.',
  ].join('\n\n');
