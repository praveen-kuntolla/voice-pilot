import { expect, test, type Page } from "@playwright/test";
import { waitForLoginHydration } from "./login-readiness";

const isolated = process.env.E2E_ISOLATED_AUTH === "true" &&
  Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

async function signIn(page: Page) {
  await waitForLoginHydration(page);
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test.describe("agent builder to offline test studio", () => {
  test.skip(!isolated, "Requires isolated local Supabase authentication fixtures.");

  test("offers safe testing only for non-archived agents and deep-links the selected agent", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard/agents");
    await expect(page.getByRole("heading", { name: "Build your voice agent." })).toBeVisible();
    const cards = page.locator(".card .card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    let tested = false;
    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      const status = (await card.innerText()).toLowerCase();
      const link = card.getByRole("link", { name: "Test safely" });
      if (status.includes("archived")) {
        await expect(link).toHaveCount(0);
      } else if (!tested) {
        await expect(link).toHaveCount(1);
        const href = await link.getAttribute("href");
        expect(href).toMatch(/^\/dashboard\/agents\/test\?agent=[^&]+$/);
        await link.click();
        await expect(page).toHaveURL(/\/dashboard\/agents\/test\?agent=/);
        await expect(page.getByRole("heading", { name: "Test an agent safely." })).toBeVisible();
        const selection = page.getByRole("combobox", { name: "Simulation agent" });
        await expect(selection).toHaveValue(new URL(page.url()).searchParams.get("agent")!);
        tested = true;
      }
    }
    expect(tested).toBeTruthy();
  });

  test("requires server preflight before a simulation can start", async ({ page }) => {
    await signIn(page);
    await page.goto("/dashboard/agents/test");
    const selection = page.getByRole("combobox", { name: "Simulation agent" });
    await expect(selection).toBeVisible();
    await selection.selectOption({ index: 1 });
    await page.route(/\/api\/agents\/[^/]+\/simulation-preflight$/, async (route) => {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Simulation preflight denied" }) });
    });
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("Simulation authorization is unavailable");
    await expect(page.getByText("State: failed")).toBeVisible();
  });
});
