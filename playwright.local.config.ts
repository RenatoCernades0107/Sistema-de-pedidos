import { defineConfig, devices } from "@playwright/test";

/**
 * Los e2e contra un Supabase LOCAL y sin tocar lo que ya esté corriendo: otro
 * puerto para la app y otro para el Odoo falso. El `playwright.config.ts` normal
 * reutiliza el `next dev` del puerto 3000, que desde un worktree es el del
 * checkout principal y sirve otro código.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<api> \
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<la del supabase local> \
 *   npx playwright test -c playwright.local.config.ts e2e/terminados.spec.ts
 */
const PUERTO_APP = Number(process.env.E2E_PUERTO_APP ?? 3100);
const PUERTO_ODOO = Number(process.env.E2E_PUERTO_ODOO ?? 8169);
const APP = `http://localhost:${PUERTO_APP}`;
const ODOO_FALSO = `http://127.0.0.1:${PUERTO_ODOO}`;

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY del Supabase local.");
}

process.env.E2E_ODOO_FALSO = ODOO_FALSO;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/preparar.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: APP, locale: "es-PE", timezoneId: "America/Lima", trace: "retain-on-failure" },
  projects: [{ name: "escritorio", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/odoo-falso.mts",
      url: `${ODOO_FALSO}/__estado`,
      env: { ODOO_FALSO_PUERTO: String(PUERTO_ODOO) },
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `npx next dev -p ${PUERTO_APP}`,
      url: APP,
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        ODOO_URL: ODOO_FALSO,
        ODOO_DB: "e2e-odoo-falso",
        ODOO_USERNAME: "e2e@plexiacril.test",
        ODOO_PASSWORD: "clave-del-odoo-falso",
      },
    },
  ],
});
