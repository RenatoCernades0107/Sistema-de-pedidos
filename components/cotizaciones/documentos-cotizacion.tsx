"use client";

/**
 * Los archivos de una cotización ya creada en Odoo, al final del chat: el PDF de
 * la cotización y, cuando se cotizó corte, la hoja de corte del taller.
 *
 * Las dos acciones apuntan a la misma URL (`app/api/cotizaciones/...`): ver lo
 * abre en el visor de la app (`VisorArchivo`), descargar le agrega `?descargar`
 * para que vaya como adjunto. La descarga es un enlace y no JavaScript: la hace
 * el navegador, no la app.
 */

import { useCallback, useState } from "react";
import { Download, FileText, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisorArchivo } from "@/components/visor-archivo";
import { useChat } from "@/app/(app)/cotizaciones/chat-store";

interface Archivo {
  clave: "cotizacion" | "hoja-corte";
  titulo: string;
  detalle: string;
  Icono: typeof FileText;
}

function urlDocumento(chatId: string, clave: Archivo["clave"], descargar = false): string {
  const base = `/api/cotizaciones/${encodeURIComponent(chatId)}/${clave}`;
  return descargar ? `${base}?descargar=1` : base;
}

export function DocumentosCotizacion() {
  const { activeChatId, documentos } = useChat();
  if (!activeChatId || !documentos) return null;

  const { cotizacion, hojaDeCorte } = documentos;

  const archivos: Archivo[] = [
    {
      clave: "cotizacion",
      titulo: `Cotización ${cotizacion.orderName}`,
      detalle: `PDF · S/ ${cotizacion.totalPen.toFixed(2)}`,
      Icono: FileText,
    },
  ];
  if (hojaDeCorte) {
    archivos.push({
      clave: "hoja-corte",
      titulo: "Hoja de corte",
      detalle: "PDF · piezas y acomodo en la plancha",
      Icono: Scissors,
    });
  }

  return (
    <div className="flex flex-col gap-2 self-start">
      <p className="eyebrow">Archivos</p>
      <ul className="flex flex-wrap gap-2">
        {archivos.map((archivo) => (
          <li key={archivo.clave}>
            <FichaArchivo chatId={activeChatId} archivo={archivo} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FichaArchivo({ chatId, archivo }: { chatId: string; archivo: Archivo }) {
  const { clave, titulo, detalle, Icono } = archivo;

  return (
    <div className="bg-muted/40 focus-within:border-ring/40 hover:border-ring/40 flex items-center gap-2.5 rounded-lg border py-2 pr-1.5 pl-2.5 transition-colors">
      <Vista chatId={chatId} clave={clave} titulo={titulo}>
        <span className="bg-card grid size-7 shrink-0 place-items-center rounded-md border">
          <Icono className="text-muted-foreground size-3.5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{titulo}</span>
          <span className="text-muted-foreground block text-2xs">{detalle}</span>
        </span>
      </Vista>

      {/* En la PWA del iPhone un `<a download>` abre el PDF a pantalla completa y
          sin salida. En el celular se descarga desde el visor, con compartir. */}
      <Button
        variant="ghost"
        size="icon-xs"
        className="hidden sm:inline-flex"
        nativeButton={false}
        render={
          <a
            href={urlDocumento(chatId, clave, true)}
            download
            aria-label={`Descargar ${titulo}`}
          />
        }
      >
        <Download />
      </Button>
    </div>
  );
}

/** La ficha abre el visor de la app: con su barra se puede volver y compartir. */
function Vista({
  chatId,
  clave,
  titulo,
  children,
}: {
  chatId: string;
  clave: Archivo["clave"];
  titulo: string;
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const cerrar = useCallback(() => setAbierto(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={`Ver ${titulo}`}
        className="focus-visible:ring-ring flex min-w-0 items-center gap-2.5 rounded text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        {children}
      </button>

      {/* Solo pide el PDF (y genera la hoja de corte en el servidor) al abrirse. */}
      <VisorArchivo
        url={urlDocumento(chatId, clave)}
        titulo={titulo}
        abierto={abierto}
        onCerrar={cerrar}
      />
    </>
  );
}
