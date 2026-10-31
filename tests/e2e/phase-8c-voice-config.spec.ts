import { expect, test } from "@playwright/test";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

test("agent builder mock voice configurator stays ephemeral, accessible, and provider-free", async ({ page }) => {
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

  await page.goto("/dashboard/agents");
  await expect(page.getByRole("heading", { name: "Mock voice configuration" })).toBeVisible();
  await expect(page.getByText("SIMULATION ONLY", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Selected mock voice: None" })).toBeVisible();

  const profile = page.getByLabel("Mock voice profile", { exact: true });
  const rate = page.getByLabel("Speaking-rate hint");
  const styleNote = page.getByLabel("Style note (optional)");
  await expect(profile.locator("option")).toHaveCount(3);

  // Full configuration flow: select, rate hint, style note, apply, deterministic text preview.
  await profile.selectOption("mock-warm-en");
  await rate.selectOption("slow");
  await styleNote.fill("Friendly greeting tone");
  await page.getByRole("button", { name: "Apply configuration" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Warm English/ })).toContainText("rate hint: slow");
  await expect(page.getByRole("status").filter({ hasText: /Warm English/ })).toContainText("style: Friendly greeting tone");
  await page.getByLabel("Preview text").fill("Phase 8C synthetic sample.");
  await page.getByRole("button", { name: "Preview profile text" }).click();
  await expect(page.getByText("No audio is rendered and no provider is contacted.")).toBeVisible();

  // Editing any control invalidates the applied configuration until re-applied.
  await styleNote.fill("Revised note");
  await expect(page.getByRole("status").filter({ hasText: "Selected mock voice: None" })).toBeVisible();

  // Language change resets the entire ephemeral configuration (en-US -> hi-IN is incompatible).
  await page.getByLabel("Language").selectOption("hi-IN");
  await expect(page.getByRole("status").filter({ hasText: /Not compatible with agent language hi-IN/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Selected mock voice: None" })).toBeVisible();

  // Switching back remains reset until explicitly applied again.
  await page.getByLabel("Language").selectOption("en-US");
  await expect(page.getByRole("status").filter({ hasText: "Selected mock voice: None" })).toBeVisible();

  // Keyboard accessibility: focus moves through native labelled controls.
  await profile.focus();
  await page.keyboard.press("ArrowDown");
  await expect(profile).toBeFocused();

  // Mobile viewport keeps controls visible and labelled.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(profile).toBeVisible();
  await expect(rate).toBeVisible();

  // Reload clears everything: state is browser memory only.
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Selected mock voice: None" })).toBeVisible();

  expect(unexpectedRequests).toEqual([]);
});
