"use client";

/**
 * Lo último antes de la pantalla en blanco: solo entra si falla el layout raíz,
 * que es quien monta el tema y las fuentes. Por eso este archivo trae su propio
 * `<html>` y `<body>` y no usa Tailwind ni los tokens de `globals.css`: cuando
 * se renderiza, esa hoja de estilos no está. Todo va en estilos en línea, con
 * `color-scheme` para que al menos siga el modo del sistema.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{
          colorScheme: "light dark",
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <title>Error · Pedidos Plexiacril</title>
        <div style={{ maxWidth: "24rem" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
            La aplicación no arrancó
          </h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.7, marginTop: "0.5rem" }}>
            Recarga la página. Si vuelve a pasar, avisa a Administración con la
            referencia de abajo.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
              borderRadius: "0.5rem",
              border: "1px solid currentColor",
              background: "transparent",
              color: "inherit",
            }}
          >
            Reintentar
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: "1rem",
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                opacity: 0.6,
              }}
            >
              Referencia: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
