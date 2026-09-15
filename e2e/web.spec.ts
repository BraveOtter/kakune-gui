import { expect, test } from "@playwright/test";

test("creates a context through the browser build", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add context" }).click();
  const form = page.locator("form.context-form");
  await form.getByLabel("Name").fill("Release smoke");
  await form.getByLabel("Endpoint").fill("http://127.0.0.1:8787");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Release smoke", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("contexts.png"), fullPage: true });
});
