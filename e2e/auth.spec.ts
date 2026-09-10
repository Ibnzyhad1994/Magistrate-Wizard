import { expect, test } from "@playwright/test";
import { signInAsSeedAdmin } from "./helpers";

test.describe("authenticated smokes", () => {
  test("seed admin reaches the app shell", async ({ page }) => {
    await signInAsSeedAdmin(page);
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible({ timeout: 30_000 });
  });

  test("notifications inbox loads", async ({ page }) => {
    await signInAsSeedAdmin(page);
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/No notices yet|Mark all read/)).toBeVisible();
  });
});
