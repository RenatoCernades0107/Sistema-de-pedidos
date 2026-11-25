"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Megaphone, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { guardarAjustesAgente } from "@/app/(app)/agente-whatsapp/acciones";
import { esquemaAjustesAgente, type AjustesAgente } from "@/lib/agente-whatsapp/ajustes";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const HACE = [
  "Responde precios de planchas y accesorios (la Lista de precios, con el precio de Odoo).",
  "Atiende a quien llega desde un anuncio de Meta, con el contexto de cada campaña.",
  "Informa sobre productos y servicios con los catálogos y fichas técnicas, y envía fotos y PDF.",
  "Da la dirección, el horario y las formas de pago (cuentas vigentes que salen en el PDF).",
];

const NO_HACE = [
  "Cotizar cortes a medida.",
  "Cotizar productos terminados.",
  "Tomar el pedido y registrarlo en el sistema.",
];

/** Lo que Administración ajusta del agente, y qué hace y qué no hace todavía. */
export function AjustesAgenteForm({ ajustes }: { ajustes: AjustesAgente }) {
  const router = useRouter();
  const [valores, setValores] = useState<AjustesAgente>(ajustes);
  const [guardando, iniciar] = useTransition();
  const sucio = JSON.stringify(valores) !== JSON.stringify(ajustes);
  const validacion = esquemaAjustesAgente.safeParse(valores);

  const guardar = () =>
    iniciar(async () => {
      const r = await guardarAjustesAgente(valores);
      if (!r.ok) {
        toast.error("No se guardó", { description: r.error });
        return;
      }
      toast.success("Ajustes del agente guardados");
      router.refresh();
    });

  const cambiarAnuncio = (i: number, campo: "sourceId" | "nombre" | "contexto", valor: string) =>
    setValores((v) => ({ ...v, anuncios: v.anuncios.map((a, j) => (j === i ? { ...a, [campo]: valor } : a)) }));

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (sucio && validacion.success) guardar();
        }}
      >
        <section className="bg-card rounded-xl border">
          <header className="bg-muted/40 border-b px-4 py-3">
            <h2 className="text-sm font-medium">Cómo responde</h2>
          </header>
          <div className="flex flex-col gap-4 p-4">
            <Campo
              label="Indicaciones adicionales"
              ayuda="Se suman a las instrucciones del agente. Ej.: «Si preguntan por envíos a provincia, di que trabajamos con Shalom y Olva.»"
            >
              <Textarea
                rows={6}
                value={valores.instrucciones}
                onChange={(e) => setValores((v) => ({ ...v, instrucciones: e.target.value }))}
              />
            </Campo>
            <Campo label="Qué dice al pasar a un asesor" ayuda="Cuando le piden algo que todavía no hace, o no sabe la respuesta.">
              <Textarea
                rows={2}
                value={valores.mensajeDerivacion}
                onChange={(e) => setValores((v) => ({ ...v, mensajeDerivacion: e.target.value }))}
              />
            </Campo>
          </div>
        </section>

        <section className="bg-card rounded-xl border">
          <header className="bg-muted/40 flex items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-medium">Anuncios de Meta</h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Cuando un cliente escribe desde un anuncio (Click-to-WhatsApp), Meta manda su ID. Aquí le dices al
                agente de qué trata cada campaña: producto, promoción, precio especial.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={valores.anuncios.length >= 50}
              onClick={() => setValores((v) => ({ ...v, anuncios: [...v.anuncios, { sourceId: "", nombre: "", contexto: "" }] }))}
            >
              <Plus data-icon="inline-start" />
              Anuncio
            </Button>
          </header>
          {valores.anuncios.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
              <Megaphone className="size-4" aria-hidden />
              Sin anuncios. El agente igual usa el titular y el texto que trae cada anuncio.
            </p>
          ) : (
            <ul className="divide-y">
              {valores.anuncios.map((a, i) => (
                <li key={i} className="flex flex-col gap-3 p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                    <Campo label="Nombre de la campaña">
                      <Input value={a.nombre} placeholder="Acrílico cristal · noviembre" onChange={(e) => cambiarAnuncio(i, "nombre", e.target.value)} />
                    </Campo>
                    <Campo label="ID del anuncio">
                      <Input value={a.sourceId} inputMode="numeric" placeholder="1202…" onChange={(e) => cambiarAnuncio(i, "sourceId", e.target.value)} />
                    </Campo>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar el anuncio ${a.nombre || i + 1}`}
                      onClick={() => setValores((v) => ({ ...v, anuncios: v.anuncios.filter((_, j) => j !== i) }))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <Campo label="Contexto para el agente">
                    <Textarea
                      rows={2}
                      value={a.contexto}
                      placeholder="Promoción de planchas de acrílico cristal 3 mm. Ofrece también el corte a medida (lo cotiza un asesor)."
                      onChange={(e) => cambiarAnuncio(i, "contexto", e.target.value)}
                    />
                  </Campo>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex items-center justify-end gap-3">
          {!validacion.success && sucio && (
            <p className="text-destructive text-xs">{validacion.error.issues[0]?.message}</p>
          )}
          <Button type="submit" disabled={guardando || !sucio || !validacion.success}>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>

      <aside className="bg-card h-fit rounded-xl border">
        <header className="bg-muted/40 border-b px-4 py-3">
          <h2 className="text-sm font-medium">Qué hace el agente</h2>
        </header>
        <div className="flex flex-col gap-4 p-4 text-sm">
          <ul className="flex flex-col gap-2">
            {HACE.map((h) => (
              <li key={h} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                {h}
              </li>
            ))}
          </ul>
          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Todavía no</p>
            <ul className="flex flex-col gap-2">
              {NO_HACE.map((h) => (
                <li key={h} className="text-muted-foreground flex gap-2">
                  <X className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {h}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-2 text-xs">Para esto pasa la conversación a un asesor.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
