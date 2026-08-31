import type { MetadataRoute } from "next";

/**
 * Manifiesto de la PWA. El taller la instala en el celular y la usa como app:
 * a pantalla completa, sin barra del navegador y con su icono en el escritorio.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pedidos · Plexiacril",
    short_name: "Plexiacril",
    description:
      "Gestión de pedidos de Plexiacril por rol: administración, logística y taller.",
    lang: "es-PE",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#18315a",
    icons: [
      {
        src: "/icono.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icono.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
