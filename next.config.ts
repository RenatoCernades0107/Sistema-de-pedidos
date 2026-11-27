import type { NextConfig } from "next";

/**
 * Las seis vistas de antes son ahora una sola, `/pedidos`, con un filtro de
 * alcance. Las rutas viejas siguen vivas en marcadores, notificaciones y
 * costumbre: se desvían al filtro equivalente. Temporales (307) por si un día
 * alguna vuelve a ser una pantalla propia.
 */
const VISTAS_ANTIGUAS: [string, string][] = [
  ["/admin", "/pedidos?ver=todos"],
  ["/mis-pedidos", "/pedidos?ver=mios"],
  ["/taller", "/pedidos?ver=taller"],
  ["/tienda", "/pedidos?ver=tienda"],
  ["/logistica", "/pedidos?ver=logistica"],
  ["/historial", "/pedidos"],
];

/**
 * Cabeceras de seguridad para todas las rutas.
 *
 * Sin CSP de scripts a propósito: Next inyecta scripts en línea y una CSP estricta
 * exige nonces en cada render; una a medias rompería la app. `frame-ancestors` sí va,
 * porque no depende de eso: impide que otro sitio meta el login en un iframe
 * (clickjacking). `SAMEORIGIN` y `'self'` dejan que la propia app se incruste.
 */
const CABECERAS_DE_SEGURIDAD = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  // pdf.js lee los PDF que se adjuntan al chat de diseños (`lib/cad/adjuntos-servidor.ts`).
  // Se carga con el `import` de Node: empaquetado no encuentra su worker.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  // Caché de navegación del cliente: volver a una vista visitada en los últimos
  // 30 s no pide nada al servidor. Las Server Actions que llaman a `refresh()`
  // (todas las escrituras) la invalidan, así que lo que cada quien cambia se ve
  // al momento; lo ajeno puede tardar hasta 30 s. Ver docs de `staleTimes`.
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
  headers() {
    return [{ source: "/:path*", headers: CABECERAS_DE_SEGURIDAD }];
  },
  redirects() {
    return VISTAS_ANTIGUAS.map(([source, destination]) => ({
      source,
      destination,
      permanent: false,
    }));
  },
};

export default nextConfig;
