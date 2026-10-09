"use client";

/**
 * Un PDF o una imagen a pantalla completa, dentro de la app, con su propia barra:
 * volver, compartir y descargar.
 *
 * Existe por la PWA del iPhone: instalada no tiene barra del navegador, y el visor
 * de PDF de iOS —en un `iframe` o en una pestaña aparte— dejaba solo las hojas,
 * sin forma de volver ni de mandar el archivo. Aquí las hojas las dibuja pdf.js
 * en `<canvas>`, así que se ven igual en iPhone, Android y escritorio, y la barra
 * es de la app.
 *
 * Abrirlo agrega una entrada al historial: el gesto de atrás del celular lo
 * cierra en vez de sacar a la persona de la pantalla en la que estaba.
 *
 * El archivo se pide una sola vez, como `File`: el mismo objeto se dibuja, se
 * comparte con la hoja nativa (WhatsApp, correo, "Guardar en Archivos") y se
 * descarga, sin volver al servidor.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Download, Loader2, Share } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Carga =
  | { estado: "cargando" }
  | { estado: "error"; mensaje: string }
  | { estado: "listo"; archivo: File };

interface Props {
  url: string;
  titulo: string;
  onCerrar: () => void;
}

/**
 * Montado solo mientras está abierto: cada apertura empieza de cero —archivo
 * pedido de nuevo, entrada de historial nueva— sin estado que reiniciar.
 */
export function VisorArchivo({ abierto, ...props }: Props & { abierto: boolean }) {
  return abierto ? <VisorAbierto key={props.url} {...props} /> : null;
}

function VisorAbierto({ url, titulo, onCerrar }: Props) {
  const [carga, setCarga] = useState<Carga>({ estado: "cargando" });
  const volverRef = useRef<HTMLButtonElement>(null);
  /* Si el visor puso su entrada en el historial, cerrarlo es `history.back()`:
     así la entrada se consume y el `popstate` hace el resto. */
  const enHistorial = useRef(false);
  /* En un ref para que el efecto del historial corra una sola vez: con
     `onCerrar` en sus dependencias, una función nueva en cada render del padre
     apilaría una entrada de historial por render. */
  const onCerrarRef = useRef(onCerrar);
  useEffect(() => {
    onCerrarRef.current = onCerrar;
  }, [onCerrar]);

  const cerrar = useCallback(() => {
    if (enHistorial.current) window.history.back();
    else onCerrarRef.current();
  }, []);

  useEffect(() => {
    window.history.pushState({ ...window.history.state, visorArchivo: true }, "");
    enHistorial.current = true;
    const alVolver = () => {
      enHistorial.current = false;
      onCerrarRef.current();
    };
    window.addEventListener("popstate", alVolver);

    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    window.addEventListener("keydown", alTeclear);

    // La página de atrás no debe moverse mientras se recorren las hojas.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    volverRef.current?.focus();

    return () => {
      window.removeEventListener("popstate", alVolver);
      window.removeEventListener("keydown", alTeclear);
      document.body.style.overflow = overflow;
    };
  }, [cerrar]);

  useEffect(() => {
    const control = new AbortController();

    (async () => {
      try {
        const r = await fetch(url, { signal: control.signal });
        if (!r.ok) {
          setCarga({ estado: "error", mensaje: (await r.text()) || "No se pudo abrir el archivo." });
          return;
        }
        const blob = await r.blob();
        const nombre =
          nombreDeDisposicion(r.headers.get("Content-Disposition")) ?? conExtension(titulo, blob.type);
        setCarga({ estado: "listo", archivo: new File([blob], nombre, { type: blob.type }) });
      } catch (e) {
        if (control.signal.aborted) return;
        setCarga({
          estado: "error",
          mensaje: e instanceof Error ? e.message : "No se pudo abrir el archivo.",
        });
      }
    })();

    return () => control.abort();
  }, [url, titulo]);

  const archivo = carga.estado === "listo" ? carga.archivo : null;
  const puedeCompartir = archivo !== null && sePuedeCompartir(archivo);

  const compartir = async () => {
    if (!archivo) return;
    try {
      await navigator.share({ files: [archivo], title: titulo });
    } catch (e) {
      // Cerrar la hoja de compartir sin elegir nada también cae aquí.
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error("No se pudo compartir", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const descargar = () => {
    if (!archivo) return;
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = archivo.name;
    enlace.click();
    // El navegador ya tomó el enlace; liberarlo en el mismo tick corta descargas en Safari.
    setTimeout(() => URL.revokeObjectURL(enlace.href), 10_000);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      className="bg-background fixed inset-0 z-50 flex flex-col"
    >
      <header className="flex items-center gap-1 border-b px-1.5 pt-[env(safe-area-inset-top)]">
        <Button ref={volverRef} variant="ghost" size="icon-lg" onClick={cerrar} aria-label="Volver">
          <ArrowLeft className="size-5" />
        </Button>
        <h2 className="min-w-0 flex-1 truncate py-3 text-sm font-medium">{titulo}</h2>

        {puedeCompartir && (
          <Button variant="ghost" size="lg" onClick={compartir} aria-label="Compartir">
            <Share className="size-5" />
            <span className="hidden sm:inline">Compartir</span>
          </Button>
        )}
        {/* En el celular compartir ya trae "Guardar en Archivos"; descargar
            aparte solo hace falta donde no se puede compartir. */}
        <Button
          variant="ghost"
          size="lg"
          onClick={descargar}
          disabled={!archivo}
          aria-label="Descargar"
          className={puedeCompartir ? "hidden sm:inline-flex" : undefined}
        >
          <Download className="size-5" />
          <span className="hidden sm:inline">Descargar</span>
        </Button>
      </header>

      <div className="bg-muted/40 min-h-0 flex-1 overflow-auto overscroll-contain p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        {carga.estado === "cargando" && <Cargando />}
        {carga.estado === "error" && <Aviso>{carga.mensaje}</Aviso>}
        {archivo &&
          (archivo.type === "application/pdf" ? (
            <PaginasPdf archivo={archivo} />
          ) : archivo.type.startsWith("image/") ? (
            <Imagen archivo={archivo} />
          ) : (
            <Aviso>Este archivo no se puede previsualizar. Descárgalo para abrirlo.</Aviso>
          ))}
      </div>
    </div>,
    document.body,
  );
}

function Cargando() {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
      <Loader2 className="size-4 animate-spin" />
      Abriendo…
    </div>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-sm">
      {children}
    </div>
  );
}

function Imagen({ archivo }: { archivo: File }) {
  /* La URL del blob vive lo que vive el `<img>`: el ref la crea al montarlo y
     la libera al quitarlo. */
  const conBlob = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      const src = URL.createObjectURL(archivo);
      img.src = src;
      return () => URL.revokeObjectURL(src);
    },
    [archivo],
  );

  // eslint-disable-next-line @next/next/no-img-element -- es un blob local, no hay nada que optimizar
  return <img ref={conBlob} alt={archivo.name} className="mx-auto h-auto max-w-full rounded-lg border" />;
}

/**
 * Cada hoja en su `<canvas>`, una debajo de otra y al ancho de la pantalla. Se
 * dibujan con más resolución que la de la pantalla para que, al ampliar con dos
 * dedos, las medidas de una hoja de corte se sigan leyendo.
 */
function PaginasPdf({ archivo }: { archivo: File }) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dibujando, setDibujando] = useState(true);

  useEffect(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;
    let cancelado = false;
    let documento: { destroy: () => Promise<void> } | null = null;

    (async () => {
      try {
        const pdfjs = await cargarPdfjs();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) }).promise;
        documento = pdf;
        if (cancelado) return;

        const ancho = contenedor.clientWidth;
        for (let n = 1; n <= pdf.numPages; n++) {
          const pagina = await pdf.getPage(n);
          if (cancelado) return;

          const base = pagina.getViewport({ scale: 1 });
          const escala = ancho / base.width;
          const vista = pagina.getViewport({ scale: escala * resolucion(base, escala) });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(vista.width);
          canvas.height = Math.floor(vista.height);
          canvas.className = "bg-white mx-auto h-auto w-full rounded-sm border shadow-xs";
          canvas.setAttribute("aria-label", `Página ${n} de ${pdf.numPages}`);

          // Se agrega ya dibujada: un canvas en blanco bajo el "Abriendo…" confunde.
          await pagina.render({ canvas, viewport: vista }).promise;
          pagina.cleanup();
          if (cancelado) return;
          contenedor.appendChild(canvas);
          if (n === 1) setDibujando(false);
        }
      } catch (e) {
        if (!cancelado) setError(e instanceof Error ? e.message : "No se pudo leer el PDF.");
      } finally {
        if (!cancelado) setDibujando(false);
      }
    })();

    return () => {
      cancelado = true;
      contenedor.replaceChildren();
      void documento?.destroy();
    };
  }, [archivo]);

  return (
    <>
      {dibujando && !error && <Cargando />}
      {error && <Aviso>{error}</Aviso>}
      {/* React no le pone hijos: los `<canvas>` los agrega el efecto. */}
      <div ref={contenedorRef} className="mx-auto flex max-w-3xl flex-col gap-3" />
    </>
  );
}

/** Píxeles de la página como máximo: más que esto y Safari se queda sin memoria para el canvas. */
const MAX_PIXELES = 6_000_000;

function resolucion(base: { width: number; height: number }, escala: number): number {
  const deseada = Math.min((window.devicePixelRatio || 1) * 1.5, 4);
  const pixeles = base.width * base.height * escala * escala;
  return Math.min(deseada, Math.sqrt(MAX_PIXELES / pixeles));
}

/* pdf.js pesa: se baja recién cuando alguien abre un PDF, y el worker se crea una
   sola vez para toda la sesión. La versión `legacy` es la que sigue funcionando
   en los iPhone que no están al día. */
let pdfjsListo: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

function cargarPdfjs() {
  pdfjsListo ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" },
    );
    return pdfjs;
  });
  return pdfjsListo;
}

function sePuedeCompartir(archivo: File): boolean {
  return typeof navigator.canShare === "function" && navigator.canShare({ files: [archivo] });
}

/** Sin extensión, WhatsApp y "Archivos" no saben con qué abrirlo: "Cotización S00042" → "….pdf". */
function conExtension(nombre: string, tipo: string): string {
  const extension = tipo.split("/")[1];
  return /\.\w{2,5}$/.test(nombre) || !extension ? nombre : `${nombre}.${extension}`;
}

/** `attachment; filename="a.pdf"; filename*=UTF-8''Cotizaci%C3%B3n.pdf` → "Cotización.pdf". */
function nombreDeDisposicion(cabecera: string | null): string | null {
  if (!cabecera) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cabecera);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // Mal codificado: se prueba con el `filename` simple.
    }
  }
  return /filename="?([^";]+)"?/i.exec(cabecera)?.[1] ?? null;
}
