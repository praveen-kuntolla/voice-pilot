import { expect, test } from "@playwright/test";

const enabled = () => process.env.E2E_ISOLATED_AUTH === "true" && Boolean(process.env.E2E_EMAIL_A && process.env.E2E_PASSWORD_A);

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL_A!);
  await page.getByLabel("Password").fill(process.env.E2E_PASSWORD_A!);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("isolated owner can manage simulated agent approvals without activating providers", async ({ page }) => {
  test.skip(!enabled(), "Isolated local governance fixtures are not configured");
  await login(page);

  await page.goto("/dashboard/agents");
  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByRole("heading", { name: "Provider governance" })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText(/Provider approval saved\. Provider activation remains disabled\./)).toBeVisible();
  await expect(page.getByText(/Admin-only policy approvals for this agent/)).toBeVisible();
});

test("isolated owner can manage organization provider governance without activating providers", async ({ page }) => {
  test.skip(!enabled(), "Isolated local governance fixtures are not configured");
  await login(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: /provider governance/i }).click();
  await expect(page.getByRole("heading", { name: "Organization provider approvals" })).toBeVisible();
  await page.getByRole("combobox", { name: "Provider" }).first().selectOption("elevenlabs");
  await page.getByLabel(/Credential reference/).fill("local-test-governance-reference");
  await page.getByRole("button", { name: "Grant approval" }).click();
  await expect(page.getByText("Approval granted.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Governance audit log/i })).toBeVisible();
  await expect(page.getByText(/All provider activation flags remain disabled/)).toBeVisible();
});
