"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePen, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { eliminarBorrador } from "@/app/(app)/borradores/acciones";
import { HORAS_BORRADOR, haceCuanto, horasRestantes, rutaDeBorrador, type BorradorListado } from "@/lib/borradores";
import { money, montoEn } from "@/lib/formato";
import { TEXTO_EN_CURSO } from "@/lib/borradores-editores";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Los pedidos o cotizaciones a medio llenar de quien mira: retomarlos o
 * eliminarlos. Se borran solos a las 48 h sin abrirlos ni editarlos.
 */
export function ListaBorradores({ borradores, nombre }: { borradores: BorradorListado[]; nombre: "pedido" | "cotización" | "compra" }) {
  const router = useRouter();
  const [porEliminar, setPorEliminar] = useState<BorradorListado | null>(null);
  const [eliminando, iniciar] = useTransition();
  const [ocultos, setOcultos] = useState<string[]>([]);

  const visibles = borradores.filter((b) => !ocultos.includes(b.id));
  if (visibles.length === 0) return null;

  const eliminar = (b: BorradorListado) =>
    iniciar(async () => {
      const r = await eliminarBorrador(b.id);
      if (!r.ok) {
        toast.error("No se pudo eliminar el borrador", { description: r.error });
        return;
      }
      setOcultos((o) => [...o, b.id]);
      setPorEliminar(null);
      toast.success("Borrador eliminado");
      router.refresh();
    });

  return (
    <section aria-labelledby="titulo-borradores" className="mb-5 rounded-lg border border-dashed p-3 md:p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h2 id="titulo-borradores" className="flex items-center gap-1.5 text-sm font-semibold">
          <FilePen className="size-4" />
          Borradores
        </h2>
        <p className="text-muted-foreground text-xs">
          Se borran solos a las {HORAS_BORRADOR} h sin abrirlos. Solo tú los ves.
        </p>
      </div>
      <ul className="divide-y">
        {visibles.map((b) => {
          const horas = horasRestantes(b.venceEn);
          return (
            <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid="borrador">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {b.resumen.cliente ?? <span className="text-muted-foreground">{nombre === "compra" ? "Sin proveedor" : "Sin cliente"}</span>}
                </p>
                <p className="text-muted-foreground text-xs">
                  {b.resumen.productos} {nombre === "compra" ? (b.resumen.productos === 1 ? "ítem" : "ítems") : b.resumen.productos === 1 ? "producto" : "productos"}
                  {b.resumen.productos > 0 && (
                    <>
                      {" · "}
                      <span className="tnum">{b.resumen.moneda ? montoEn(b.resumen.total, b.resumen.moneda) : money(b.resumen.total)}</span>
                    </>
                  )}
                  {b.resumen.enCurso && (
                    <span data-testid="borrador-en-curso">{` · con ${TEXTO_EN_CURSO[b.resumen.enCurso]}`}</span>
                  )}
                  {" · editado "}
                  {haceCuanto(b.actualizadoEn)}
                  {" · se borra en "}
                  {horas} h
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button render={<Link href={rutaDeBorrador(b)} />} nativeButton={false} size="sm" variant="outline">
                  Retomar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Eliminar borrador"
                  title="Eliminar borrador"
                  onClick={() => setPorEliminar(b)}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <AlertDialog open={!!porEliminar} onOpenChange={(abierto) => !abierto && setPorEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este borrador?</AlertDialogTitle>
            <AlertDialogDescription>
              Se pierde lo que se había llenado de{" "}
              {nombre === "pedido" ? "este pedido" : nombre === "compra" ? "esta compra" : "esta cotización"}
              {porEliminar?.resumen.cliente ? (nombre === "compra" ? ` a ${porEliminar.resumen.cliente}` : ` para ${porEliminar.resumen.cliente}`) : ""}. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Conservar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={eliminando}
              // Se cierra cuando termine: si falla, el diálogo sigue ahí.
              onClick={() => porEliminar && eliminar(porEliminar)}
            >
              {eliminando && <Loader2 className="animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** El estado del autoguardado, discreto junto al título del formulario. */
export function IndicadorBorrador({ estado }: { estado: "sin-guardar" | "guardando" | "guardado" | "error" }) {
  const texto = {
    "sin-guardar": null,
    guardando: "Guardando borrador…",
    guardado: "Borrador guardado",
    error: "No se pudo guardar el borrador",
  }[estado];
  if (!texto) return null;
  return (
    <p
      role="status"
      className={estado === "error" ? "text-destructive text-xs" : "text-muted-foreground text-xs"}
      data-testid="estado-borrador"
    >
      {texto}
    </p>
  );
}
