// Accessibility: no serious or critical axe violation (WCAG 2.1 A and AA) inside `selector`.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function expectAccessible(page: Page, selector: string) {
  // axe reads colours as they are painted: a page still fading in reads as too faint (a production build gets there
  // within its fade). So it waits for the animations that end; a spinner's runs forever and is left alone.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
  );
  const { violations } = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)).toEqual([]);
}
