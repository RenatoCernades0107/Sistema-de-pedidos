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

const nextConfig: NextConfig = {
  // pdf.js lee los PDF que se adjuntan al chat de diseños (`lib/cad/adjuntos-servidor.ts`).
  // Se carga con el `import` de Node: empaquetado no encuentra su worker.
  serverExternalPackages: ["pdfjs-dist"],
  redirects() {
    return VISTAS_ANTIGUAS.map(([source, destination]) => ({
      source,
      destination,
      permanent: false,
    }));
  },
};

export default nextConfig;
