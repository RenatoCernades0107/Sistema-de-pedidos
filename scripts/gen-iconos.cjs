/* Genera los PNG del icono a partir de public/icono.svg.
 *
 * Hacen falta porque iOS no acepta SVG: ni para el icono de la pantalla de inicio
 * (que es el paso obligatorio para que el iPhone pueda recibir avisos) ni para el
 * icono que sale en la notificación. Sin ellos la PWA se instala con un cuadro en
 * blanco y el push llega pelado.
 *
 * La "P" va como trazado y no como <text>: rasterizar texto depende de las fuentes
 * que tenga instalada la máquina que corre el script, y Geist no está en ninguna.
 * Con el trazado, el PNG sale idéntico en cualquier sitio.
 *
 *   node scripts/gen-iconos.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const RAIZ = path.join(__dirname, "..");

const FONDO = "#18315A";
const MARCA = "#FFC100";

/* La P de Plexiacril, dibujada sobre el lienzo de 512: asta vertical y ojo
   rectangular con la contraforma recortada por `fill-rule: evenodd`. */
const P =
  "M176 128 h104 a92 92 0 0 1 0 184 h-52 v72 h-52 z" +
  "M228 180 v80 h52 a40 40 0 0 0 0 -80 z";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${FONDO}"/>
  <path d="${P}" fill="${MARCA}" fill-rule="evenodd"/>
</svg>`;

/* El icono maskable de Android se recorta en círculo, así que el dibujo tiene que
   caber en el 80% central; se reusa el mismo trazado, encogido, sobre un fondo a
   sangre (sin esquinas redondeadas, las pone el sistema). */
const SVG_MASKABLE = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${FONDO}"/>
  <g transform="translate(256 256) scale(0.72) translate(-256 -256)">
    <path d="${P}" fill="${MARCA}" fill-rule="evenodd"/>
  </g>
</svg>`;

const SALIDAS = [
  { svg: SVG, tamano: 192, destino: "public/icono-192.png" },
  { svg: SVG, tamano: 512, destino: "public/icono-512.png" },
  { svg: SVG_MASKABLE, tamano: 512, destino: "public/icono-maskable-512.png" },
  // Next lo detecta por el nombre y emite el <link rel="apple-touch-icon"> solo.
  { svg: SVG, tamano: 180, destino: "app/apple-icon.png" },
];

(async () => {
  for (const { svg, tamano, destino } of SALIDAS) {
    const ruta = path.join(RAIZ, destino);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    await sharp(Buffer.from(svg)).resize(tamano, tamano).png({ compressionLevel: 9 }).toFile(ruta);
    console.log(`  ${destino}  ${tamano}×${tamano}`);
  }
  console.log("Iconos generados.");
})();
