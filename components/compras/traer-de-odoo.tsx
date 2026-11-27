"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CloudDownload } from "lucide-react";
import * as acciones from "@/app/(app)/compras/acciones";
import { ESTADOS_COMPRA, TIPOS_COMPRA } from "@/lib/compras";
import type { ResultadoImportacion } from "@/lib/compras-servidor";
import { diaMesTexto, montoEn } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Revision = Extract<ResultadoImportacion, { ok: true }>;

/**
 * Trae a la app las órdenes de compra que se hicieron directo en Odoo. Primero
 * se revisa qué entraría y qué no (y por qué); recién al confirmar se guarda.
 */
export function TraerDeOdoo({ odooListo }: { odooListo: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [desde, setDesde] = useState("");
  const [revision, setRevision] = useState<Revision | null>(null);
  const [pendiente, iniciar] = useTransition();

  const pedir = (aplicar: boolean) =>
    iniciar(async () => {
      const r = await acciones.traerComprasDeOdoo({ aplicar, desde: desde || null });
      if (!r.ok) return void toast.error(r.error);
      setRevision(r);
      if (!aplicar) return;
      if (r.fallidas.length) toast.error(`${r.fallidas.length} orden(es) no se pudieron guardar. Mira el detalle.`);
      else toast.success(r.importadas === 1 ? "Se trajo 1 orden de Odoo." : `Se trajeron ${r.importadas} órdenes de Odoo.`);
    });

  const abrir = () => {
    setRevision(null);
    setAbierto(true);
    pedir(false);
  };

  const hechas = revision?.aplicado ?? false;

  return (
    <>
      <Button variant="outline" className="gap-1.5" onClick={abrir} disabled={!odooListo}>
        <CloudDownload />
        Traer de Odoo
      </Button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Órdenes de compra de Odoo</DialogTitle>
            <DialogDescription>
              Las órdenes confirmadas en Odoo que la app no tiene. Quedan como compras ya confirmadas y, si algo ya llegó,
              con esa recepción anotada.
            </DialogDescription>
          </DialogHeader>

          <label className="flex items-center gap-2 text-sm">
            Solo pedidas desde
            <Input
              type="date"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value);
                setRevision(null);
              }}
              className="w-auto"
            />
            <Button variant="outline" size="sm" onClick={() => pedir(false)} disabled={pendiente}>
              Revisar
            </Button>
          </label>

          {!revision ? (
            <p className="text-muted-foreground py-6 text-center text-sm">{pendiente ? "Leyendo Odoo…" : "—"}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {revision.truncado && (
                <p className="text-sm">Hay más órdenes de las que se leyeron. Usa “desde” para traerlas por tramos.</p>
              )}

              <section>
                <h3 className="mb-1.5 text-sm font-medium">
                  {hechas ? `Importadas: ${revision.importadas}` : `Entrarían: ${revision.porImportar.length}`}
                </h3>
                {revision.porImportar.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No hay órdenes nuevas para traer.</p>
                ) : (
                  <ul className="divide-y rounded-lg border text-sm">
                    {revision.porImportar.map((c) => (
                      <li key={c.orden} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                        <span className="font-medium">{c.orden}</span>
                        <span className="min-w-0 flex-1 truncate">{c.proveedor}</span>
                        <span className="text-muted-foreground text-xs">
                          {TIPOS_COMPRA[c.tipo]} · {ESTADOS_COMPRA[c.estado]} · {diaMesTexto(c.fecha)}
                        </span>
                        <span className="tnum font-medium">{montoEn(c.total, c.moneda)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {revision.fallidas.length > 0 && (
                <section>
                  <h3 className="text-destructive mb-1.5 text-sm font-medium">No se pudieron guardar: {revision.fallidas.length}</h3>
                  <ul className="divide-y rounded-lg border text-sm">
                    {revision.fallidas.map((f) => (
                      <li key={f.orden} className="px-3 py-2">
                        <span className="font-medium">{f.orden}</span> — {f.error}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {revision.omitidas.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-sm font-medium">Se quedan fuera: {revision.omitidas.length}</h3>
                  <ul className="divide-y rounded-lg border text-sm">
                    {revision.omitidas.map((o) => (
                      <li key={o.ordenId} className="px-3 py-2">
                        <span className="font-medium">{o.ordenNombre}</span>
                        <span className="text-muted-foreground"> · {o.proveedor}</span>
                        <p className="text-muted-foreground text-xs">{o.motivo}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>
              {hechas ? "Cerrar" : "Cancelar"}
            </Button>
            {!hechas && (
              <Button onClick={() => pedir(true)} disabled={pendiente || !revision || revision.porImportar.length === 0}>
                {revision && revision.porImportar.length > 0 ? `Traer ${revision.porImportar.length}` : "Traer"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
