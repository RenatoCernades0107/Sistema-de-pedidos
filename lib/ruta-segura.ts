/**
 * Convierte un destino que viene del navegador (`?siguiente=…`) en una ruta interna
 * segura para `redirect()`. Cualquier cosa que pueda salir del sitio —`//evil.com`,
 * `/\evil.com`, `https://…`, `javascript:…`— se descarta y devuelve `"/"`.
 *
 * `startsWith("/")` no basta: `//evil.com` también empieza por barra y el navegador
 * lo resuelve como una URL sin protocolo hacia otro dominio.
 */
export function rutaInternaSegura(valor: string | null | undefined): string {
  if (!valor || !valor.startsWith("/")) return "/";
  // Barra doble o barra + contrabarra: los navegadores las tratan como `//host`.
  if (valor.startsWith("//") || valor.startsWith("/\\")) return "/";
  // Saltos de línea, tabuladores y demás caracteres de control: algunos navegadores
  // los eliminan al resolver la URL y `/\t/evil.com` se vuelve `//evil.com`.
  if (/[\u0000-\u001f\u007f\\]/.test(valor)) return "/";

  try {
    const base = "http://interno.invalid";
    const url = new URL(valor, base);
    if (url.origin !== base) return "/";
  } catch {
    return "/";
  }

  return valor;
}
