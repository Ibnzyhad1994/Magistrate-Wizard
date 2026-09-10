import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jsPDF from "jspdf";
import { signInAsSeedAdmin } from "./helpers";

const PdfCtor = typeof jsPDF === "function" ? jsPDF : jsPDF.jsPDF;

test.describe("document PDF redaction", () => {
  test("draw boxes and download a burned copy without changing the original control", async ({
    page,
  }) => {
    const fixturePath = join(tmpdir(), "mw-redact-fixture.pdf");
    const fixture = new PdfCtor({ unit: "pt", format: "a4" });
    fixture.setFontSize(18);
    fixture.text("SECRET123", 72, 120);
    writeFileSync(fixturePath, Buffer.from(fixture.output("arraybuffer")));

    await signInAsSeedAdmin(page);

    await page.goto("/docket");
    await page.getByText("GEO-2026-001").first().click();
    await expect(page.getByRole("heading", { name: "Police v. Demo Defendant" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("tab", { name: "Documents" }).click();
    await expect(page.getByRole("tab", { name: "Documents" })).toBeVisible();
    const fileInput = page.locator('input[type="file"]');
    await page.getByRole("button", { name: "Upload document" }).click();
    await fileInput.setInputFiles(fixturePath);
    await expect(page.getByText("mw-redact-fixture.pdf").first()).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "View mw-redact-fixture.pdf" }).first().click();
    const redactButton = page.getByRole("button", { name: "Redact", exact: true });
    await expect(redactButton).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByLabel("Download", { exact: true })).toBeVisible();

    await redactButton.click();
    const overlay = page.getByLabel(/Draw a redaction box on page 1/);
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    if (!box) throw new Error("redaction overlay had no box");
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 120);
    await page.mouse.up();

    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: "Download redacted PDF" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/redacted/i);
    const path = await download.path();
    expect(path).toBeTruthy();

    await page.goto("/legislation");
    await expect(page.getByRole("heading", { name: "Legislation" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Redact", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download redacted PDF" })).toHaveCount(0);
  });
});
