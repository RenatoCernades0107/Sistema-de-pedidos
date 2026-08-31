import { defineConfig, devices } from "@playwright/test";
import { config as cargarEnv } from "dotenv";

/* Las claves de Supabase salen del mismo `.env.local` que usa `next dev`: los tests
   entran por la app, no por un backend de mentira. */
cargarEnv({ path: ".env.local", quiet: true });

export default defineConfig({
  testDir: "./e2e",
  /* La base es la de producción y no hay otra, así que los tests van en serie:
     dos navegadores moviendo el mismo pedido a la vez probarían otra cosa. */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_URL ?? "http://localhost:3000",
    locale: "es-PE",
    timezoneId: "America/Lima",
    trace: "retain-on-failure",
  },

  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command: "npm run dev",
    url: process.env.E2E_URL ?? "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
