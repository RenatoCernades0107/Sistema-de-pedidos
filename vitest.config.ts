import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Pruebas unitarias: la lógica pura (búsqueda, líneas, esquemas) y el cliente de
 * Odoo contra el Odoo falso de `e2e/odoo-falso.mts`. Ninguna toca la red ni la
 * base: las de punta a punta, contra la app de verdad, son las de Playwright
 * (`npm run e2e`) y viven en `e2e/`.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // Los de Odoo cambian variables de entorno: en serie dentro de cada archivo.
    sequence: { concurrent: false },
  },
});
