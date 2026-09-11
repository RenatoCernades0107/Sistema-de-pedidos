"use client";

/**
 * El texto de una respuesta del agente, con su formato.
 *
 * El agente no escribe en el formato de WhatsApp aunque salga del mismo bot: su
 * prompt no pide ningún formato y el backend pasa lo que devuelve Gemini tal
 * cual, que es Markdown — `**negrita**`, `*itálica*`, listas con `-` o `*`,
 * títulos `###` y a veces tablas para el bosquejo de precios. Pintado como texto
 * plano, el colaborador veía los asteriscos.
 *
 * `remark-breaks` no es opcional: Gemini escribe muchas líneas sueltas
 * ("Producto: …⏎Cantidad: …⏎Total: …") y en Markdown estándar un salto simple
 * no corta el párrafo — sin el plugin el bosquejo saldría en una sola línea,
 * peor que antes.
 *
 * Los tamaños son los de la burbuja, no los de un documento: un `###` dentro de
 * un chat no debería gritar. Por eso tampoco se usa `@tailwindcss/typography`.
 *
 * react-markdown no interpreta el HTML que venga en el texto (lo deja como
 * texto), así que una respuesta rara del modelo no puede inyectar nada.
 */

import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const PLUGINS = [remarkGfm, remarkBreaks];

/**
 * Los props que react-markdown le pasa a un elemento, listos para el DOM y con
 * la clase de la burbuja. Descarta `node` —el nodo del árbol de Markdown, que
 * acabaría como atributo— y suma la clase propia a la que ya traiga el elemento
 * (`language-js` en un bloque de código, `task-list-item` en una casilla), en
 * vez de pisarla.
 */
function conClase<P extends { node?: unknown; className?: string }>(
  { node, className, ...props }: P,
  clase: string,
) {
  void node;
  return { ...props, className: cn(clase, className) };
}

const TITULO = "text-[0.95rem] font-semibold";
const SUBTITULO = "font-semibold";
const CELDA = "border-border border px-2 py-1";

const COMPONENTES: Components = {
  strong: (p) => <strong {...conClase(p, "font-semibold")} />,
  em: (p) => <em {...conClase(p, "italic")} />,
  del: (p) => <del {...conClase(p, "line-through")} />,

  // Una lista dentro de otra no está entre los hijos directos del contenedor,
  // así que el `space-y` no la separa: se le da su propio margen.
  ul: (p) => <ul {...conClase(p, "list-disc space-y-0.5 pl-5 [li>&]:mt-0.5")} />,
  ol: (p) => <ol {...conClase(p, "list-decimal space-y-0.5 pl-5 [li>&]:mt-0.5")} />,
  li: (p) => <li {...conClase(p, "marker:text-muted-foreground")} />,

  // Un `#` no pesa más que un `###` en una burbuja: dos tamaños alcanzan.
  h1: (p) => <h3 {...conClase(p, TITULO)} />,
  h2: (p) => <h3 {...conClase(p, TITULO)} />,
  h3: (p) => <h4 {...conClase(p, SUBTITULO)} />,
  h4: (p) => <h4 {...conClase(p, SUBTITULO)} />,
  h5: (p) => <h4 {...conClase(p, SUBTITULO)} />,
  h6: (p) => <h4 {...conClase(p, SUBTITULO)} />,

  // Una tabla ancha se desplaza dentro de la burbuja en vez de estirarla.
  table: (p) => (
    <div className="overflow-x-auto">
      <table {...conClase(p, "border-border w-full border-collapse border text-xs tabular-nums")} />
    </div>
  ),
  th: (p) => <th {...conClase(p, cn(CELDA, "bg-background/60 text-left font-medium"))} />,
  td: (p) => <td {...conClase(p, CELDA)} />,

  code: (p) => <code {...conClase(p, "bg-background/60 rounded px-1 py-0.5 font-mono text-xs")} />,
  // Dentro de un bloque el fondo ya lo pone el `pre`: el `code` no repite el suyo.
  pre: (p) => (
    <pre
      {...conClase(p, "bg-background/60 overflow-x-auto rounded-md p-2 [&_code]:bg-transparent [&_code]:p-0")}
    />
  ),

  a: (p) => (
    <a {...conClase(p, "underline underline-offset-2")} target="_blank" rel="noopener noreferrer" />
  ),
  hr: (p) => <hr {...conClase(p, "border-border my-3")} />,
  blockquote: (p) => (
    <blockquote {...conClase(p, "border-border text-muted-foreground border-l-2 pl-3")} />
  ),
};

export function TextoAgente({ texto }: { texto: string }) {
  return (
    <div className="space-y-2 break-words">
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTES}>
        {texto}
      </ReactMarkdown>
    </div>
  );
}
