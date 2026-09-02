/* Genera el par de claves VAPID que identifica a este servidor ante el servicio
 * de push (RFC 8292).
 *
 *   node scripts/gen-vapid.cjs
 *
 * Escribe `vapid.local.json` (ignorado por git) y solo imprime la mitad pública.
 * La privada no sale por pantalla a propósito: es la que firma, y una terminal
 * queda en el historial. De ahí va a los secretos de la Edge Function.
 *
 * Correrlo otra vez invalida las suscripciones que ya existan: la clave pública
 * queda grabada en cada suscripción del navegador. Se genera una vez.
 */

const fs = require("node:fs");
const path = require("node:path");
const { subtle } = require("node:crypto").webcrypto;

const ALGO = { name: "ECDSA", namedCurve: "P-256" };

(async () => {
  const par = await subtle.generateKey(ALGO, true, ["sign", "verify"]);

  // El mismo formato que espera `importVapidKeys` de @negrel/webpush.
  const jwk = {
    publicKey: await subtle.exportKey("jwk", par.publicKey),
    privateKey: await subtle.exportKey("jwk", par.privateKey),
  };

  // La application server key es la clave pública en crudo, en base64url: es lo
  // que el navegador pasa a pushManager.subscribe().
  const crudo = Buffer.from(await subtle.exportKey("raw", par.publicKey));
  const publica = crudo.toString("base64url");

  const destino = path.join(__dirname, "..", "vapid.local.json");
  fs.writeFileSync(destino, JSON.stringify(jwk, null, 2) + "\n", { mode: 0o600 });

  console.log("Par VAPID generado.");
  console.log(`  Privada  → ${path.relative(process.cwd(), destino)} (ignorada por git; guárdala)`);
  console.log("");
  console.log("NEXT_PUBLIC_VAPID_PUBLIC_KEY=" + publica);
})();
