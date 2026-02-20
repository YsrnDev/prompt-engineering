import { expect, type Locator, test, type Page } from '@playwright/test';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface GeneratePayload {
  messages?: ChatMessage[];
}

const findLastUserPrompt = (payload: GeneratePayload): string => {
  const messages = payload.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return messages[index].content.trim();
    }
  }

  return '';
};

const mockGenerateRoute = async (page: Page): Promise<void> => {
  await page.route('**/api/generate', async (route) => {
    let payload: GeneratePayload = {};

    try {
      payload = route.request().postDataJSON() as GeneratePayload;
    } catch {
      payload = {};
    }

    const prompt = findLastUserPrompt(payload) || 'No user prompt';
    const body = [
      JSON.stringify({ type: 'chunk', text: '### Mocked Response\n' }),
      JSON.stringify({ type: 'chunk', text: `Prompt received: ${prompt}` }),
      JSON.stringify({ type: 'done' }),
      '',
    ].join('\n');

    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson; charset=utf-8',
      body,
    });
  });
};

const expectWithinViewport = async (
  page: Page,
  locator: Locator
): Promise<void> => {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();

  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();

  if (!box || !viewport) {
    return;
  }

  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
};

test.beforeEach(async ({ page }) => {
  await mockGenerateRoute(page);
});

test('critical ui stays visible on current viewport', async ({ page }) => {
  await page.goto('/');

  await expectWithinViewport(
    page,
    page.getByRole('heading', { name: 'Start Your Prompt' })
  );
  await expectWithinViewport(page, page.getByLabel('Prompt input'));
});

test('user can load template and generate response', async ({ page }) => {
  await page.goto('/');

  const input = page.getByLabel('Prompt input');

  await page.getByRole('button', { name: 'Use Persona Pattern' }).click();

  await expect(input).not.toHaveValue('');
  await input.press('Enter');

  await expect(page.getByText('### Mocked Response')).toBeVisible();

  const copyButton = page.getByRole('button', {
    name: 'Copy assistant response',
  });
  await copyButton.click();
  await expect(copyButton).toContainText('Copied');
});
