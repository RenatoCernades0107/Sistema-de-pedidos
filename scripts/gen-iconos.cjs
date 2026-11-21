/* Genera los PNG del icono a partir de public/icono.svg.
 *
 * Hacen falta porque iOS no acepta SVG: ni para el icono de la pantalla de inicio
 * (que es el paso obligatorio para que el iPhone pueda recibir avisos) ni para el
 * icono que sale en la notificación. Sin ellos la PWA se instala con un cuadro en
 * blanco y el push llega pelado.
 *
 * El símbolo del logotipo (las dos piezas de la "P" en perspectiva) va como
 * trazado, igual que en icono.svg, así el PNG sale idéntico en cualquier sitio.
 *
 *   node scripts/gen-iconos.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const RAIZ = path.join(__dirname, "..");

const FONDO = "#1F15C4";
const MARCA = "#E2CB01";

/* El símbolo de Plexiacril en su propio lienzo de 56 × 94: la pieza de arriba
   (el ojo de la P) y el asta de la izquierda. `SIMBOLO` lo centra en el de 512. */
const P = "M4 13 L27 0 L56 16.5 L56 51 L33 64 L33 29 Z M0 46 L23 33 L23 94 L0 81 Z";
const SIMBOLO = `<g transform="translate(166.4 105.6) scale(3.2)"><path d="${P}" fill="${MARCA}"/></g>`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${FONDO}"/>
  ${SIMBOLO}
</svg>`;

/* El icono maskable de Android se recorta en círculo, así que el dibujo tiene que
   caber en el 80% central; se reusa el mismo trazado, encogido, sobre un fondo a
   sangre (sin esquinas redondeadas, las pone el sistema). */
const SVG_MASKABLE = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${FONDO}"/>
  <g transform="translate(256 256) scale(0.72) translate(-256 -256)">
    ${SIMBOLO}
  </g>
</svg>`;

const SALIDAS = [
  { svg: SVG, tamano: 192, destino: "public/icono-192.png" },
  { svg: SVG, tamano: 512, destino: "public/icono-512.png" },
  { svg: SVG_MASKABLE, tamano: 512, destino: "public/icono-maskable-512.png" },
  // Next lo detecta por el nombre y emite el <link rel="apple-touch-icon"> solo.
  { svg: SVG, tamano: 180, destino: "app/apple-icon.png" },
];

/* app/favicon.ico no sale de aquí (sharp no escribe .ico): se armó con los mismos
   trazados a 16, 32, 48 y 64 px. */

(async () => {
  for (const { svg, tamano, destino } of SALIDAS) {
    const ruta = path.join(RAIZ, destino);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    await sharp(Buffer.from(svg)).resize(tamano, tamano).png({ compressionLevel: 9 }).toFile(ruta);
    console.log(`  ${destino}  ${tamano}×${tamano}`);
  }
  console.log("Iconos generados.");
})();
