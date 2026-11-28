"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Download, Loader2, Scissors } from "lucide-react";
import { toast } from "sonner";
import { calcularCorteProyectoAccion } from "@/app/(app)/disenos/acciones";
import { guardarArchivo } from "@/components/disenos/dxf-planchas";
import { nombreSeguro } from "@/lib/cad/proyectos";
import type { CorteProyectoVista } from "@/lib/cad/proyecto-corte-servidor";
import { Button } from "@/components/ui/button";

const cm = (mm: number) => Math.round(mm / 10);

/** La respuesta de error de una ruta de DXF, en una frase. */
async function motivoDe(res: Response): Promise<string> {
  const cuerpo = (await res.json().catch(() => ({}))) as { error?: string; errores?: { mensaje: string }[] };
  const detalle = cuerpo.errores?.map((e) => e.mensaje).join(" ");
  return [cuerpo.error ?? "No se pudo generar el archivo.", detalle].filter(Boolean).join(" ");
}

/**
 * El corte conjunto de un proyecto: las piezas de todos sus diseños acomodadas
 * juntas en las mismas planchas, para perder menos material, con un DXF por
 * plancha. Lo que se corta en un material que no está en el catálogo (MDF) no va
 * en las planchas: se baja aparte, por diseño.
 *
 * Regenera cada diseño (unos segundos), así que se calcula a pedido.
 */
export function CorteConjunto({ proyectoId, nombreProyecto }: { proyectoId: string; nombreProyecto: string }) {
  const [calculando, calcular] = useTransition();
  const [corte, setCorte] = useState<CorteProyectoVista | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);

  function recalcular() {
    calcular(async () => {
      try {
        setCorte(await calcularCorteProyectoAccion(proyectoId));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo calcular el corte conjunto.");
      }
    });
  }

  async function bajar(clave: string, peticion: { url: string; cuerpo: unknown; nombre: string }) {
    setBajando(clave);
    try {
      const res = await fetch(peticion.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(peticion.cuerpo),
      });
      if (!res.ok) {
        toast.error(await motivoDe(res));
        return;
      }
      guardarArchivo(await res.blob(), peticion.nombre);
    } catch {
      toast.error("No se pudo descargar el archivo. Revisa tu conexión.");
    } finally {
      setBajando(null);
    }
  }

  const base = nombreSeguro(nombreProyecto);
  const nombreDe = (ref: string) => corte?.disenos.find((d) => d.ref === ref)?.nombre ?? ref;
  // Lo que se corta aparte, junto por diseño: un solo archivo por diseño.
  const aparte = new Map<string, { nombre: string; solo: Record<string, number[]>; lineas: string[] }>();
  for (const c of corte?.corteAparte ?? []) {
    const previo = aparte.get(c.disenoId) ?? { nombre: c.disenoNombre, solo: {}, lineas: [] };
    previo.solo = { ...previo.solo, ...c.solo };
    previo.lineas.push(`${c.nombre} ×${c.copias} · ${c.material} (${c.espesorMm} mm)`);
    aparte.set(c.disenoId, previo);
  }

  return (
    <section aria-label="Corte conjunto" className="mt-8 border-t pt-5">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight">Corte conjunto</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Las piezas de todos los diseños acomodadas juntas en las mismas planchas, con un DXF por plancha.
          </p>
        </div>
        <Button variant="outline" className="gap-1.5" onClick={recalcular} disabled={calculando}>
          {calculando ? <Loader2 className="animate-spin" /> : <Scissors />}
          {corte ? "Volver a calcular" : "Calcular corte conjunto"}
        </Button>
      </div>

      {calculando && !corte && (
        <p className="text-muted-foreground text-sm" role="status">
          Calculando… vuelve a generar cada diseño, tarda unos segundos.
        </p>
      )}

      {corte && (
        <div className="flex flex-col gap-4">
          {corte.problemas.length > 0 && (
            <div role="alert" className="border-destructive/40 bg-destructive/5 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <AlertTriangle className="text-destructive size-4" aria-hidden />
                Antes de cortar hay que resolver:
              </p>
              <ul className="text-muted-foreground mt-1.5 list-disc pl-5 text-sm">
                {corte.problemas.map((p) => (
                  <li key={p} className="break-words">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {corte.grupos.length === 0 && corte.problemas.length === 0 && (
            <p className="text-muted-foreground text-sm">No hay piezas que acomodar en planchas.</p>
          )}

          {corte.grupos.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">Planchas</h3>
                <Button
                  size="sm"
                  className="ml-auto gap-1.5"
                  disabled={!corte.listo || bajando !== null}
                  onClick={() =>
                    void bajar("todas", { url: "/api/cad/dxf-proyecto", cuerpo: { proyectoId }, nombre: `${base}-planchas.dxf` })
                  }
                >
                  {bajando === "todas" ? <Loader2 className="animate-spin" /> : <Download />}
                  DXF de todas las planchas
                </Button>
              </div>
              <ul className="flex flex-col gap-2">
                {corte.grupos.map((g) => (
                  <li key={g.clave} className="bg-card flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words">{g.etiqueta}</p>
                      <p className="text-muted-foreground text-xs">
                        {g.formato
                          ? `${g.planchas} ${g.planchas === 1 ? "plancha" : "planchas"} de ${cm(g.formato.anchoMm)} × ${cm(g.formato.altoMm)} cm · merma ${g.mermaPct} %`
                          : "Sin formato de plancha"}
                      </p>
                      <p className="text-muted-foreground text-xs break-words">
                        {g.aportes.map((a) => `${nombreDe(a.ref)} (${a.copias})`).join(" · ")}
                      </p>
                      {g.problemas.map((p) => (
                        <p key={p} className="text-destructive text-xs break-words">
                          {p}
                        </p>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={!corte.listo || bajando !== null}
                      onClick={() =>
                        void bajar(g.clave, {
                          url: "/api/cad/dxf-proyecto",
                          cuerpo: { proyectoId, grupo: g.clave },
                          nombre: `${base}-planchas-${nombreSeguro(g.etiqueta, "grupo")}.dxf`,
                        })
                      }
                    >
                      {bajando === g.clave ? <Loader2 className="animate-spin" /> : <Download />}
                      DXF
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {aparte.size > 0 && (
            <div>
              <h3 className="text-sm font-medium">Cortes aparte</h3>
              <p className="text-muted-foreground mb-2 text-xs">
                En un material que no está en el catálogo de planchas: no se acomodan, se bajan por diseño.
              </p>
              <ul className="flex flex-col gap-2">
                {[...aparte].map(([disenoId, a]) => (
                  <li key={disenoId} className="bg-card flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words">{a.nombre}</p>
                      <p className="text-muted-foreground text-xs break-words">{a.lineas.join(" · ")}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={bajando !== null}
                      onClick={() =>
                        void bajar(`aparte-${disenoId}`, {
                          url: "/api/cad/dxf-suelto",
                          cuerpo: { disenoId, solo: a.solo },
                          nombre: `${nombreSeguro(a.nombre, "diseno")}-corte-aparte.dxf`,
                        })
                      }
                    >
                      {bajando === `aparte-${disenoId}` ? <Loader2 className="animate-spin" /> : <Download />}
                      DXF suelto
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {corte.avisos.map((a) => (
            <p key={a} className="text-muted-foreground text-xs break-words">
              {a}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
