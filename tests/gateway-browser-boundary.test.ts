import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

describe("privileged gateway browser boundary", () => {
  it("has no public API route importing the privileged PostgreSQL boundary", () => {
    const routes = globSync("src/app/api/**/route.ts");
    for (const route of routes) expect(readFileSync(route, "utf8"), route).not.toMatch(/privileged-safety-gateway|postgres-durable-safety/);
  });

  it("keeps privileged modules guarded as server-only code", () => {
    for (const file of ["src/lib/trusted-authorization-server.ts", "src/lib/privileged-safety-gateway.ts", "src/lib/postgres-durable-safety.ts"]) {
      expect(readFileSync(file, "utf8"), file).toContain('typeof window !== "undefined"');
    }
  });
});
