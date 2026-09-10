import type { Page } from "@playwright/test";

export const SEED_ADMIN_EMAIL = "admin@magistrate-wizard.local";
export const SEED_ADMIN_PASSWORD = "password123";

export async function skipWalkthroughIfPresent(page: Page) {
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible({ timeout: 4000 }).catch(() => false)) {
    await skip.click();
  }
}

export async function signInAsSeedAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").click();
  await page.getByLabel("Email").pressSequentially(SEED_ADMIN_EMAIL, { delay: 15 });
  await page.getByLabel("Password").click();
  await page.getByLabel("Password").pressSequentially(SEED_ADMIN_PASSWORD, { delay: 15 });
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
  await skipWalkthroughIfPresent(page);
}
