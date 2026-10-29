import { expect, test } from "@playwright/test";
import { waitForLoginHydration } from "./login-readiness";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" &&
  Boolean(process.env.E2E_EMAIL_C && process.env.E2E_PASSWORD_C);

test("isolated campaign simulation populates dedicated Calls and Analytics without sending anything", async ({ page }) => {
  test.skip(!isolated, "Requires the existing isolated local Supabase fixtures.");

  await waitForLoginHydration(page);
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL_C!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_C!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/dashboard/calls");
  await expect(page.getByRole("heading", { name: "Simulated calls" })).toBeVisible();
  await expect(page.getByText("No synthetic outcomes yet")).toBeVisible();

  await page.goto("/dashboard/campaigns#simulation-studio");
  await page.getByLabel("Simulation campaign").selectOption({ label: "E2E Campaign A · draft" });
  await page.getByRole("button", { name: /run readiness check/i }).click();
  await expect(page.getByText(/Ready\. This is simulation only\./i)).toBeVisible();
  await page.getByLabel("Mock outcome").selectOption("callback_requested");
  await page.getByRole("button", { name: "Start simulation" }).click();
  await expect(page.getByText(/Simulation progress updated locally/)).toBeVisible();

  await page.goto("/dashboard/calls");
  const table = page.getByRole("table", { name: "Synthetic activity table" });
  await expect(table).toBeVisible();
  await expect(table).toContainText("Callback requested");
  await table.getByRole("button", { name: "View outcome" }).first().click();
  await expect(page.getByRole("region", { name: "Selected synthetic outcome" })).toContainText("No contact, phone, transcript");
  await page.getByLabel("Outcome filter").selectOption("no_answer");
  await expect(page.getByText("No outcomes match these filters")).toBeVisible();
  await page.getByLabel("Outcome filter").selectOption("all");

  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Simulation analytics" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic outcome breakdown" })).toContainText("Callback requested");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download redacted JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("voicepilot-tab-synthetic-outcomes.json");
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Synthetic report download missing");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  expect(JSON.parse(text)).toMatchObject({ simulationOnly: true, source: "browser_tab_only" });
  expect(text).not.toMatch(/contactId|organizationId|phone|email|transcript/i);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear tab activity" }).click();
  await expect(page.getByText("No synthetic outcomes yet")).toBeVisible();
  await page.goto("/dashboard/calls");
  await expect(page.getByText("No synthetic outcomes yet")).toBeVisible();
});
