import { expect, type Page } from "@playwright/test";

/** Collects only diagnostic categories and local script paths; never logs form data or cookies. */
export async function waitForLoginHydration(page: Page) {
  const evidence = { pageErrors: 0, consoleErrors: 0, scriptFailures: [] as string[], navigations: [] as string[], crashed: false, readyState: "unknown", formCount: 0, loginButtonCount: 0, loginButtonEnabled: false };
  const onPageError = () => { evidence.pageErrors++; };
  const onConsole = (message: { type(): string }) => { if (message.type() === "error") evidence.consoleErrors++; };
  const onRequestFailed = (request: { resourceType(): string; url(): string; failure(): { errorText: string } | null }) => {
    if (request.resourceType() !== "script") return;
    const path = new URL(request.url()).pathname;
    evidence.scriptFailures.push(`${path}: ${request.failure()?.errorText ?? "failed"}`);
  };
  const onResponse = (response: { request(): { resourceType(): string }; status(): number; url(): string }) => {
    if (response.request().resourceType() === "script" && response.status() >= 400) evidence.scriptFailures.push(`${new URL(response.url()).pathname}: HTTP ${response.status()}`);
  };
  const onNavigation = (frame: { parentFrame(): unknown; url(): string }) => { if (!frame.parentFrame()) { try { evidence.navigations.push(new URL(frame.url()).pathname); } catch { evidence.navigations.push("[invalid-url]"); } } };
  const onCrash = () => { evidence.crashed = true; };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);
  page.on("framenavigated", onNavigation);
  page.on("crash", onCrash);
  try {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.readyState === "interactive" || document.readyState === "complete", undefined, { timeout: 10_000 });
    try {
      await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeEnabled({ timeout: 10_000 });
    } catch {
      evidence.readyState = await page.evaluate(() => document.readyState);
      evidence.formCount = await page.locator("form").count();
      evidence.loginButtonCount = await page.getByRole("button", { name: "Log in", exact: true }).count();
      evidence.loginButtonEnabled = evidence.loginButtonCount > 0 && await page.getByRole("button", { name: "Log in", exact: true }).isEnabled().catch(() => false);
      throw new Error(`Login hydration did not complete: ${JSON.stringify(evidence)}`);
    }
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    page.off("requestfailed", onRequestFailed);
    page.off("response", onResponse);
    page.off("framenavigated", onNavigation);
    page.off("crash", onCrash);
  }
}
