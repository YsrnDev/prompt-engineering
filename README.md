# Prompt Engineer Generator

Prompt generator berbasis React + Vite untuk mengubah instruksi sederhana menjadi prompt yang lebih detail, terstruktur, dan siap dipakai di AI agent lain (Gemini, Claude Code, Kiro, Kimi, dll).

## Fitur Utama

- OpenAI-compatible API only (melalui proxy server lokal `/api/generate`).
- Mode generasi prompt: `Simple`, `Advanced`, `Expert`.
- Target agent profile: `Universal`, `Gemini`, `Claude Code`, `Kiro`, `Kimi`.
- Skills integration (opsional) dari `skills.sh`.
- UI chat responsif mobile/desktop.
- PWA support (installable di Android pada mode production + HTTPS).

## Tech Stack

- React 19
- Vite 6
- TypeScript
- Tailwind CSS 4
- Playwright (E2E)

## Prasyarat

- Node.js 18+ (disarankan versi LTS terbaru)
- npm

## Setup Lokal

1. Install dependency:

```bash
npm install
```

2. Buat/isi file `.env.local`:

```env
# Wajib: pilih salah satu URL
OPENAI_COMPATIBLE_URL=https://your-provider.com/v1/chat/completions
# atau:
# OPENAI_COMPATIBLE_BASE_URL=https://your-provider.com

# Wajib
OPENAI_COMPATIBLE_MODEL=gpt-4o-mini

# Opsional (jika endpoint perlu auth bearer)
OPENAI_COMPATIBLE_API_KEY=your_api_key

# Opsional UI
VITE_ENABLE_SIDEBAR=false

# Opsional skills.sh
SKILLS_SH_DISABLE=false
SKILLS_SH_PROMPT_ENGINEERING_PATTERN_REF=prompt-engineering-patterns
SKILLS_SH_UI_UX_PRO_MAX_REF=ui-ux-pro-max-skill
```

3. Jalankan dev server:

```bash
npm run dev
```

4. Buka:

`http://localhost:3000`

## API Lokal

- `POST /api/generate`
  - Proxy streaming ke OpenAI-compatible endpoint.
- `GET /api/skills-status`
  - Cek status skill yang berhasil dimuat.

## PWA (Install di Android)

PWA aktif di build production (service worker didaftarkan hanya saat `import.meta.env.PROD`).

1. Build aplikasi:

```bash
npm run build
```

2. Serve hasil build via HTTPS (atau localhost).
3. Buka di Chrome Android.
4. Pilih menu `Install app` / `Add to Home screen`.

File terkait PWA:

- `public/manifest.webmanifest`
- `public/sw.js`
- `public/icons/*`

## Scripts

- `npm run dev` menjalankan Vite dev server.
- `npm run build` build production.
- `npm run preview` preview build.
- `npm run lint` type check TypeScript.
- `npm run test` unit test logic chat.
- `npm run test:e2e` Playwright E2E.
- `npm run test:e2e:headed` Playwright E2E mode headed.
- `npm run test:e2e:report` buka report Playwright.

## Testing E2E

Install browser Playwright (sekali saja):

```bash
npx playwright install chromium
```

Jalankan E2E:

```bash
npm run test:e2e
```

## Struktur Folder

```txt
components/   UI components
hooks/        React hooks
lib/          Shared parsing/helper logic
services/     Client-side API streaming handler
server/       Vite middleware proxy + skills integration
public/       Static assets + PWA files
tests/        Unit dan E2E tests
```

## Catatan

- API key tetap di sisi server (tidak diekspos ke browser).
- Jika mengubah `public/sw.js` dan update tidak muncul, clear site data/service worker lalu reload.
