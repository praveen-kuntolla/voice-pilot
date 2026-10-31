import { expect, test } from "@playwright/test";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

test("authenticated voice profile lab stays deterministic, accessible, and provider-free", async ({ page }) => {
  test.skip(!isolated, "Requires approved isolated local Supabase fixtures.");
  const unexpectedRequests: string[] = [];
  page.on("request", (request) => {
    if (/livekit|deepgram|elevenlabs|openai\.com|twilio|telnyx/i.test(request.url())) unexpectedRequests.push(request.url());
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/dashboard/agents/voice-preview");
  await expect(page.getByRole("heading", { name: "Voice profile lab" })).toBeVisible();
  await expect(page.getByText("SIMULATION ONLY", { exact: false }).first()).toBeVisible();

  const profile = page.getByLabel("Voice profile");
  await expect(profile.locator("option")).toHaveCount(3);
  await profile.selectOption("mock-calm-en");
  await page.getByLabel("Preview text").fill("Keyboard-safe synthetic sample.");
  await page.getByRole("button", { name: "Preview profile text" }).click();
  await expect(page.getByRole("status")).toContainText("Calm English");
  await expect(page.getByRole("status")).toContainText("No audio was generated.");

  await profile.selectOption("mock-clear-en");
  await page.getByRole("button", { name: "Preview profile text" }).click();
  await expect(page.getByRole("alert")).toContainText("does not match the agent language");
  await profile.selectOption("mock-calm-en");
  await page.getByLabel("Preview text").fill("");
  await page.getByRole("button", { name: "Preview profile text" }).click();
  await expect(page.getByRole("alert")).toContainText("Enter sample text");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Voice profile")).toBeVisible();
  expect(unexpectedRequests).toEqual([]);
  await page.reload();
  await expect(page.getByRole("status")).toHaveCount(0);
});
