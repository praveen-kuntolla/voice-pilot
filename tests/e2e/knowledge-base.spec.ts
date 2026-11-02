import { expect, test } from "@playwright/test";
import { waitForLoginHydration } from "./login-readiness";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

test.describe("authenticated knowledge base", () => {
  test.skip(!isolated, "Requires isolated local Supabase authentication fixtures.");
  test("owner creates, edits, reloads and deletes local sources", async ({ page }) => {
    await waitForLoginHydration(page);
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto("/dashboard/knowledge");
    await expect(page.getByRole("heading", { name: "Give agents useful context." })).toBeVisible();
    await expect(page.getByText(/not indexed or available for agent retrieval/i)).toHaveCount(0);
    const title = `Synthetic support ${Date.now()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Content or reference").fill("Synthetic local policy text; no provider retrieval.");
    await page.getByRole("button", { name: "Add source" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Title").fill(`${title} edited`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: `${title} edited` })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: `${title} edited` })).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name: `${title} edited` })).toHaveCount(0);
  });

  test("rejects unsafe URL references and keeps file references metadata-only", async ({ page }) => {
    await waitForLoginHydration(page);
    await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
    await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page).toHaveURL(/dashboard/);
    const invalid = await page.evaluate(async () => (await fetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Unsafe", source_type: "url", source_uri: "javascript:alert(1)" }) })).status);
    expect(invalid).toBe(400);
    await page.goto("/dashboard/knowledge");
    await page.getByLabel("Title").fill(`Synthetic file ${Date.now()}`);
    await page.getByLabel("Source type").selectOption("file");
    await page.getByLabel("Content or reference").fill("synthetic-upload.txt");
    await page.getByRole("button", { name: "Add source" }).click();
    await expect(page.getByText(/file · ready/i)).toBeVisible();
    await expect(page.getByText(/stored reference only/i)).toBeVisible();
    await expect(page.getByText(/not indexed or available for agent retrieval/i)).toBeVisible();
    await page.goto("/dashboard/agents");
    await expect(page.getByRole("heading", { name: "Knowledge source availability" })).toBeVisible();
    await expect(page.getByText(/Indexed: 0 · Retrievable: 0 · Agent assignment: unavailable/i)).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.goto("/dashboard/knowledge");
    await page.getByRole("button", { name: "Delete" }).click();
  });
});
