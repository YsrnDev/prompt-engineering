<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1wDoF0Bv8pygW65X1noQQJ76kQxywN6oy

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Configure OpenAI-compatible env in [.env.local](.env.local):
   - set `OPENAI_COMPATIBLE_URL` (or `OPENAI_COMPATIBLE_BASE_URL`, root URL or full `/v1/chat/completions`)
   - set `OPENAI_COMPATIBLE_MODEL`
   - set `OPENAI_COMPATIBLE_API_KEY` if your endpoint requires auth
   - optional UI flag: set `VITE_ENABLE_SIDEBAR=true` to show sidebar navigation (default hidden)
   - optional skills integration refs:
     - `SKILLS_SH_PROMPT_ENGINEERING_PATTERN_REF`
     - `SKILLS_SH_UI_UX_PRO_MAX_REF`
     - `SKILLS_SH_DISABLE=true` to disable loading external skills
3. Run the app:
   `npm run dev`

## Notes

- Requests are proxied through a local server endpoint (`/api/generate`) managed by Vite middleware.
- The API key stays server-side and is not injected into the browser bundle.
- Skills integration status can be checked via `GET /api/skills-status`.
- Provider:
  - OpenAI-compatible endpoint URL
- Prompt generator modes:
  - `Simple` for fast, lightweight prompt outputs
  - `Advanced` for balanced structure and rationale (default)
  - `Expert` for deeper optimization and stricter prompt engineering constraints
- Target agent profiles:
  - `Universal` (portable)
  - `Gemini`
  - `Claude Code`
  - `Kiro`
  - `Kimi`
- Quality checks:
  - `npm run lint` for TypeScript type checks
  - `npm run test` for core chat logic tests
  - `npm run test:e2e` for Playwright responsive E2E (mobile/tablet/desktop)
  - `npm run test:e2e:headed` to run E2E tests in headed mode
  - `npm run test:e2e:report` to open the latest Playwright HTML report

## Playwright E2E

1. Install browser binaries once:
   `npx playwright install chromium`
2. Run responsive E2E suite:
   `npm run test:e2e`

The suite runs the same functional checks against these viewports: `mobile-small`, `mobile-large`, `tablet`, `desktop`, and `desktop-wide`.
