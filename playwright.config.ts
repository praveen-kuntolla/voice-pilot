import {defineConfig,devices} from "@playwright/test";
const baseURL=process.env.PLAYWRIGHT_BASE_URL||"http://localhost:3000";
const isolatedAuth=process.env.E2E_ISOLATED_AUTH==="true";
const reuseExistingServer=process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER==="true"||!isolatedAuth;
export default defineConfig({testDir:"./tests/e2e",use:{baseURL,trace:isolatedAuth?"off":"retain-on-failure"},webServer:{command:`npm run dev -- -p ${new URL(baseURL).port||3000}`,url:baseURL,reuseExistingServer},projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}}]});
