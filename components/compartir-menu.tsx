"use client";

/**
 * El botón "Compartir" de una cotización o de un pedido: WhatsApp y Gmail con
 * el mensaje ya escrito, copiar el enlace y, si hay, descargar el PDF o el
 * texto. En el celular, además, la hoja nativa de compartir.
 *
 * Los enlaces llegan como rutas (`/c/<token>/pdf`) y se completan con el origen
 * de la página al usarlos: así salen bien en local, en el preview y en
 * producción sin una variable de entorno más.
 */

import { useState, useSyncExternalStore } from "react";
import { ChevronDown, Copy, FileDown, FileText, Mail, MessageCircle, Share, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { tituloCuenta, type CuentaPublica } from "@/lib/cuentas-bancarias";
import { enlaceGmail, enlaceWhatsApp } from "@/lib/compartir";

interface Props {
  /** Lo que dice el botón. */
  etiqueta?: string;
  /** La ruta pública que se comparte (el PDF o la página de seguimiento). */
  ruta: string;
  /** El mensaje, con el enlace ya absoluto. */
  mensaje: (url: string) => string;
  asunto: string;
  telefono?: string | null;
  /** Si se ofrece "Descargar PDF": la ruta pública sirve el PDF. */
  esPdf?: boolean;
  /** Las cuentas que se pueden elegir para el PDF; salen marcadas las de Configuración. */
  cuentasPdf?: CuentaPublica[];
  /** Si se ofrece "Descargar texto": el contenido y el nombre del archivo. */
  texto?: { contenido: string; nombre: string };
  variant?: "default" | "outline";
  className?: string;
  /**
   * Se llama cuando algo salió hacia el cliente: WhatsApp, Gmail, otras apps,
   * copiar el enlace o descargar el PDF. Ver el PDF no cuenta: es mirarlo.
   */
  alCompartir?: () => void;
}

const sinSuscripcion = () => () => {};
/** `navigator.share` existe solo en el navegador (y no en todos): nada en el servidor. */
const usePuedeCompartir = () =>
  useSyncExternalStore(
    sinSuscripcion,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );

export function CompartirMenu({
  etiqueta = "Compartir",
  ruta,
  mensaje,
  asunto,
  telefono,
  esPdf,
  cuentasPdf = [],
  texto,
  variant = "outline",
  className,
  alCompartir,
}: Props) {
  const puedeCompartir = usePuedeCompartir();
  // `null`: sin tocar, o sea lo marcado en Configuración. Lo que se elige aquí vale solo para estas descargas.
  const [elegidas, setElegidas] = useState<ReadonlySet<string> | null>(null);
  const marcada = (c: CuentaPublica) => (elegidas ? elegidas.has(c.id) : c.enPdf);
  const alternar = (c: CuentaPublica, v: boolean) => {
    const ids = new Set(cuentasPdf.filter((x) => (x.id === c.id ? v : marcada(x))).map((x) => x.id));
    setElegidas(ids);
  };
  /** El PDF con las cuentas elegidas; sin tocar nada, la ruta tal cual (manda Configuración). */
  const rutaPdf = (extra = "") => {
    const q = new URLSearchParams(extra);
    if (elegidas) q.set("cuentas", [...elegidas].join(","));
    const qs = q.toString();
    return qs ? `${ruta}?${qs}` : ruta;
  };
  const url = () => new URL(ruta, window.location.origin).toString();

  const abrir = (destino: string) => {
    window.open(destino, "_blank", "noopener,noreferrer");
    alCompartir?.();
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url());
      toast.success("Enlace copiado");
      alCompartir?.();
    } catch {
      toast.error("No se pudo copiar el enlace");
    }
  };

  const compartirNativo = async () => {
    try {
      await navigator.share({ title: asunto, text: mensaje(url()) });
      alCompartir?.();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error("No se pudo compartir");
    }
  };

  const descargarTexto = () => {
    if (!texto) return;
    const archivo = new Blob([texto.contenido], { type: "text/plain;charset=utf-8" });
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = texto.nombre;
    enlace.click();
    // Liberarlo en el mismo tick corta descargas en Safari.
    setTimeout(() => URL.revokeObjectURL(enlace.href), 10_000);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant={variant} className={className ?? "gap-1.5"} />}>
        <Share2 />
        {etiqueta}
        <ChevronDown className="text-muted-foreground size-3.5" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Enviar al cliente</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => abrir(enlaceWhatsApp(telefono, mensaje(url())))} className="gap-2">
            <MessageCircle className="text-[#25D366]" />
            WhatsApp
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => abrir(enlaceGmail(asunto, mensaje(url())))} className="gap-2">
            <Mail className="text-[#EA4335]" />
            Gmail
          </DropdownMenuItem>
          {puedeCompartir && (
            <DropdownMenuItem onClick={compartirNativo} className="gap-2">
              <Share />
              Otras apps…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={copiar} className="gap-2">
            <Copy />
            Copiar enlace
          </DropdownMenuItem>
        </DropdownMenuGroup>

        {(esPdf || texto) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Archivo</DropdownMenuLabel>
              {esPdf && (
                <DropdownMenuItem render={<a href={rutaPdf()} target="_blank" rel="noreferrer" />} className="gap-2">
                  <FileText />
                  Ver PDF
                </DropdownMenuItem>
              )}
              {esPdf && (
                <DropdownMenuItem
                  render={<a href={rutaPdf("descargar=1")} download />}
                  onClick={() => alCompartir?.()}
                  className="gap-2"
                >
                  <FileDown />
                  PDF
                </DropdownMenuItem>
              )}
              {esPdf && cuentasPdf.length > 0 && (
                <>
                  <DropdownMenuLabel>Cuentas en el PDF</DropdownMenuLabel>
                  {cuentasPdf.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.id}
                      checked={marcada(c)}
                      onCheckedChange={(v) => alternar(c, v)}
                      closeOnClick={false}
                    >
                      <span className="truncate">{tituloCuenta(c)}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              )}
              {texto && (
                <DropdownMenuItem onClick={descargarTexto} className="gap-2">
                  <FileText />
                  Texto (.txt)
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
