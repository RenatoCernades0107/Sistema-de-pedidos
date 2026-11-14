import { defineConfig, devices } from "@playwright/test";
import { config as cargarEnv } from "dotenv";

/* Las claves de Supabase salen del mismo `.env.local` que usa `next dev`: los tests
   entran por la app, no por un backend de mentira. */
cargarEnv({ path: ".env.local", quiet: true });

/** Dónde escucha el Odoo falso. Lo leen también las pruebas, por `E2E_ODOO_FALSO`. */
const PUERTO_ODOO_FALSO = 8069;
const ODOO_FALSO = `http://127.0.0.1:${PUERTO_ODOO_FALSO}`;
process.env.E2E_ODOO_FALSO ??= ODOO_FALSO;

/** Dónde escucha el motor CAD falso: los productos terminados se diseñan con él. */
const PUERTO_CAD_FALSO = 8091;
const CAD_FALSO = `http://127.0.0.1:${PUERTO_CAD_FALSO}`;

export default defineConfig({
  testDir: "./e2e",
  /* Baja la marca de "cambia tu contraseña" a las tres cuentas del seed. Sin
     esto, la migración que la introdujo deja a las tres atascadas en esa pantalla
     y no pasa ninguna prueba. */
  globalSetup: "./e2e/preparar.ts",
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

  webServer: [
    /* Un Odoo de mentira para las cotizaciones (`e2e/odoo-falso.mts`). Ninguna
       prueba crea clientes ni cotizaciones en el Odoo de la empresa. */
    {
      command: `node e2e/odoo-falso.mts`,
      url: `${ODOO_FALSO}/__estado`,
      env: { ODOO_FALSO_PUERTO: String(PUERTO_ODOO_FALSO) },
      reuseExistingServer: true,
      timeout: 30_000,
    },
    /* Un motor CAD de mentira (`e2e/cad-falso.mts`): plantillas y despiece sin el
       servicio Python de `cad/`. */
    {
      command: `node e2e/cad-falso.mts`,
      url: `${CAD_FALSO}/__estado`,
      env: { CAD_FALSO_PUERTO: String(PUERTO_CAD_FALSO) },
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run dev",
      url: process.env.E2E_URL ?? "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
      /* El entorno del proceso le gana a `.env.local`: este `next dev` habla con
         el Odoo falso. Si ya había uno corriendo (`reuseExistingServer`), puede
         estar apuntando al Odoo real; `e2e/cotizaciones.spec.ts` lo comprueba
         antes de crear nada. */
      env: {
        ODOO_URL: ODOO_FALSO,
        ODOO_DB: "e2e-odoo-falso",
        ODOO_USERNAME: "e2e@plexiacril.test",
        ODOO_PASSWORD: "clave-del-odoo-falso",
        CAD_API_BASE_URL: CAD_FALSO,
        CAD_API_KEY: "",
      },
    },
  ],
});
