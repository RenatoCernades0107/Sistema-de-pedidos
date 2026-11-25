import { Fragment, type ReactNode } from "react";

/**
 * El formato de WhatsApp: *negrita*, _cursiva_, ~tachado~ y enlaces, con los
 * saltos de línea tal cual. No es Markdown (ahí `*x*` sería cursiva): es lo que
 * verá el cliente en su teléfono.
 */
const PATRON = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/[^\s]+)/g;

function linea(texto: string, clave: string): ReactNode[] {
  return texto.split(PATRON).map((parte, i) => {
    const k = `${clave}-${i}`;
    if (/^\*[^*\n]+\*$/.test(parte)) return <strong key={k}>{parte.slice(1, -1)}</strong>;
    if (/^_[^_\n]+_$/.test(parte)) return <em key={k}>{parte.slice(1, -1)}</em>;
    if (/^~[^~\n]+~$/.test(parte)) return <s key={k}>{parte.slice(1, -1)}</s>;
    if (/^https?:\/\//.test(parte)) {
      return (
        <a key={k} href={parte} target="_blank" rel="noreferrer noopener" className="break-all text-sky-700 underline dark:text-sky-400">
          {parte}
        </a>
      );
    }
    return <Fragment key={k}>{parte}</Fragment>;
  });
}

export function TextoWhatsApp({ texto }: { texto: string }) {
  const lineas = texto.split("\n");
  return (
    <>
      {lineas.map((l, i) => (
        <Fragment key={i}>
          {linea(l, String(i))}
          {i < lineas.length - 1 && <br />}
        </Fragment>
      ))}
    </>
  );
}
