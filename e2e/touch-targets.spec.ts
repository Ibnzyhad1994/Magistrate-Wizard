// Runs in CI only (the authenticated Playwright smokes job, against local
// Supabase and its seed). It is not part of the local test loop, and nobody
// is expected to run it on a developer machine.
import { expect, test, type Page } from "@playwright/test";
import { signInAsSeedAdmin } from "./helpers";

/**
 * Touch targets on a phone (docs/ui-conventions.md, "Touch targets"): below
 * the lg breakpoint every visible, enabled control is at least 44px tall.
 *
 * The one exception is a control inside running text, such as the "N matters
 * in all" link in the capacity caption: WCAG 2.5.8 exempts a target whose
 * size is set by the line height of the sentence around it. It is detected
 * as a control whose computed display is `inline` or `inline-block` and
 * whose nearest block ancestor has text of its own. A flex or grid child is
 * never inline (the layout blockifies it), so a button in a toolbar row
 * cannot slip through.
 *
 * A native checkbox or radio is measured together with its label, because
 * tapping the label toggles it.
 *
 * The TanStack Query devtools toggle is skipped: it only exists in a dev
 * build (`import.meta.env.DEV`), which is what the CI job serves.
 */
const PHONE = { width: 390, height: 844 };
const MIN = 44;

test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

interface Target {
  control: string;
  width: number;
  height: number;
}

async function undersizedTargets(page: Page): Promise<Target[]> {
  return page.evaluate((min) => {
    const selector = [
      "a[href]",
      "button",
      'input:not([type="hidden"])',
      "select",
      "textarea",
      "summary",
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[role="radio"]',
      '[role="combobox"]',
      '[role="menuitem"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(", ");

    const isInline = (el: Element) => {
      const display = getComputedStyle(el).display;
      return display === "inline" || display === "inline-block";
    };
    const inRunningText = (el: Element) => {
      if (!isInline(el)) return false;
      let block = el.parentElement;
      while (block && isInline(block)) block = block.parentElement;
      if (!block) return false;
      const own = (block.textContent ?? "").replace(el.textContent ?? "", "");
      return own.trim().length > 0;
    };
    const box = (el: Element) => {
      const rects = [el, ...(el instanceof HTMLInputElement ? [...(el.labels ?? [])] : [])].map(
        (node) => node.getBoundingClientRect(),
      );
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      return { width: right - left, height: bottom - top };
    };

    return [...document.querySelectorAll(selector)]
      .filter((el) => {
        if (el.matches(":disabled, [aria-disabled='true']")) return false;
        if (el.closest("[aria-hidden='true'], [inert]")) return false;
        if (el.closest(".tsqd-parent-container")) return false;
        if (el.getAttribute("aria-label") === "Open Tanstack query devtools") return false;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        const rect = el.getBoundingClientRect();
        // Visually hidden (sr-only) controls such as the skip link are 1px.
        return rect.width > 1 && rect.height > 1;
      })
      .filter((el) => !inRunningText(el))
      .map((el) => ({ el, ...box(el) }))
      .filter(({ height }) => height < min - 0.5)
      .map(({ el, width, height }) => {
        const name = (
          el.getAttribute("aria-label") ||
          el.textContent ||
          el.getAttribute("placeholder") ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
        return {
          control: `${el.tagName.toLowerCase()} "${name}"`,
          width: Math.round(width),
          height: Math.round(height * 10) / 10,
        };
      });
  }, MIN);
}

async function expectTouchTargets(page: Page) {
  // Let lazy sections and the first query round settle before measuring.
  await page.waitForLoadState("networkidle");
  const undersized = await undersizedTargets(page);
  expect(undersized, JSON.stringify(undersized, null, 2)).toEqual([]);
}

test.describe("touch targets at 390 x 844", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsSeedAdmin(page);
  });

  test("home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
    await expectTouchTargets(page);
  });

  test("docket list and a matter", async ({ page }) => {
    await page.goto("/docket");
    await expect(page.getByRole("heading", { level: 1, name: /Docket/ })).toBeVisible({
      timeout: 30_000,
    });
    await expectTouchTargets(page);

    // The seeded matter opens from its card; its page has the stage grid,
    // tabs and actions a magistrate uses on a phone.
    const matter = page.getByRole("link", { name: /GEO-2026-001/ }).first();
    if (await matter.isVisible().catch(() => false)) {
      await matter.click();
      await page.waitForURL(/\/docket\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
      await expectTouchTargets(page);
    }
  });

  test("judgments", async ({ page }) => {
    await page.goto("/judgments");
    await expect(page.getByRole("heading", { level: 1, name: /Judgments/ })).toBeVisible({
      timeout: 30_000,
    });
    await expectTouchTargets(page);
  });

  test("case law", async ({ page }) => {
    await page.goto("/case-law");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await expectTouchTargets(page);
  });
});
