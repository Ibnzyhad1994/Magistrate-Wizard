import { expect, test } from "@playwright/test";

test.describe("unauthenticated smokes", () => {
  test("login page shows Sign In and credential fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("bad credentials stay on login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").click();
    await page.getByLabel("Email").pressSequentially("nobody@example.test", { delay: 15 });
    await page.getByLabel("Password").click();
    await page.getByLabel("Password").pressSequentially("wrong-password", { delay: 15 });
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  });

  test("unknown route shows not-found", async ({ page }) => {
    await page.goto("/this-page-does-not-exist");
    await expect(page.getByRole("heading", { name: "Lost your way?" })).toBeVisible();
  });
});
