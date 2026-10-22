import {defineConfig,devices} from "@playwright/test";
const baseURL=process.env.PLAYWRIGHT_BASE_URL||"http://localhost:3000";
const isolatedAuth=process.env.E2E_ISOLATED_AUTH==="true";
export default defineConfig({testDir:"./tests/e2e",use:{baseURL,trace:isolatedAuth?"off":"retain-on-failure"},webServer:{command:`npm run dev -- -p ${new URL(baseURL).port||3000}`,url:baseURL,reuseExistingServer:!isolatedAuth},projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}}]});
