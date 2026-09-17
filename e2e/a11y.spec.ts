import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInAsSeedAdmin } from "./helpers";

/**
 * Accessibility smokes (audit §4.7): axe-core over the routes a magistrate
 * lives in, plus the per-route `document.title` that `usePageTitle` sets.
 *
 * Runs the WCAG 2.x A/AA rule tags only, so a failure here is a real
 * conformance defect rather than a best-practice nit. The failure message
 * lists each violation's rule id, impact and CSS targets so the offending
 * element can be found without re-running under a debugger.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

test.describe("accessibility smokes", () => {
  test("login page has no axe violations and a page title", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign In" })).toBeVisible();
    await expect(page).toHaveTitle(/Sign In/);
    await expectNoAxeViolations(page);
  });

  test("dashboard has no axe violations and a page title", async ({ page }) => {
    await signInAsSeedAdmin(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("main")).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveTitle(/Dashboard/);
    await expectNoAxeViolations(page);
  });

  test("docket has no axe violations and a page title", async ({ page }) => {
    await signInAsSeedAdmin(page);
    await page.goto("/docket");
    await expect(page.getByRole("heading", { level: 1, name: /Docket/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveTitle(/Docket/);
    await expectNoAxeViolations(page);
  });

  test("judgments has no axe violations and a page title", async ({ page }) => {
    await signInAsSeedAdmin(page);
    await page.goto("/judgments");
    await expect(page.getByRole("heading", { level: 1, name: /Judgments/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveTitle(/Judgments/);
    await expectNoAxeViolations(page);
  });

  test("people admin has no axe violations and a page title", async ({ page }) => {
    await signInAsSeedAdmin(page);
    await page.goto("/admin/people");
    await expect(page.getByRole("heading", { level: 1, name: /People/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveTitle(/People/);
    await expectNoAxeViolations(page);
  });

  test("route change moves focus to the main landmark and announces the page", async ({ page }) => {
    await signInAsSeedAdmin(page);
    await page.goto("/judgments");
    await expect(page.getByRole("heading", { level: 1, name: /Judgments/ })).toBeVisible({
      timeout: 30_000,
    });
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: /Docket/ })
      .click();
    await expect(page).toHaveTitle(/Docket/);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ""))
      .toBe("main-content");
    await expect(page.getByText(/Navigated to Docket/)).toBeAttached();
  });
});
