import { Package } from "lucide-react";
import { money } from "@/lib/formato";
import {
  cantidadDeMaterial,
  renglonesDeTerminado,
  type MaterialUsado,
  type TerminadoGuardado,
} from "@/lib/terminados/guardado";
import { armadoDeCaja } from "@/lib/terminados/armado";
import { Carrusel } from "@/components/ui/carrusel";
import { Caja3D } from "./armado-caja";
import { CortesTerminado } from "./cortes-terminado";

const n = (x: number) => String(+x.toFixed(3));

/**
 * La ficha de un producto terminado ya guardado: qué es, cómo se pidió y qué
 * material se estimó. Es lo que lee el taller para fabricarlo; con `conPrecios`,
 * también lo que ve Administración: el precio sugerido junto al cobrado.
 */
export function TerminadoGuardadoVista({
  terminado: t,
  cantidad,
  importe = null,
  usados = null,
  conPrecios,
  sinMaterial = false,
  imagenes = [],
}: {
  terminado: TerminadoGuardado;
  cantidad: number;
  importe?: number | null;
  /** Lo que logística anotó que se usó de verdad. */
  usados?: MaterialUsado[] | null;
  conPrecios: boolean;
  /** Sin el recuadro de material: el pedido lo junta de todos sus ítems en su propia vista. */
  sinMaterial?: boolean;
  /** Fotos del producto, para verlas junto a la caja en 3D (después de ella). */
  imagenes?: { clave: string; nombre: string; contenido: React.ReactNode }[];
}) {
  const renglones = renglonesDeTerminado(t);
  const vistas = [
    ...(armadoDeCaja(t.geometria, t.medidas)
      ? [{ clave: "3d", nombre: "La caja en 3D", contenido: <Caja3D geometria={t.geometria} medidas={t.medidas} /> }]
      : []),
    ...imagenes,
  ];
  return (
    // El diseño sigue al ancho de su columna, no al de la pantalla: con el chat
    // abierto al lado (o en la cotización) la ficha se apila en vez de partirse.
    <div className="@container flex flex-col gap-2.5" data-testid="linea-terminado">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <Package className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 basis-48">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <span className="tnum">{n(cantidad)} ×</span>
            {t.productoCodigo && (
              <span className="bg-muted/60 rounded border px-1.5 py-px font-mono text-xs font-normal whitespace-nowrap">
                {t.productoCodigo}
              </span>
            )}
            <span>{t.nombre}</span>
            <span className="bg-brand-soft rounded-md px-1.5 py-0.5 text-xs">
              {t.estandar ? (t.tipoNombre ?? "Producto terminado") : "Personalizado"}
            </span>
          </p>
        </div>
        {conPrecios && importe !== null && (
          <div className="ml-auto shrink-0 pl-7 text-right">
            <p className="tnum text-sm font-medium">{money(importe)}</p>
            <p className="text-muted-foreground tnum text-xs">
              {money(t.precioUnitario)} c/u
              {t.precioUnitario !== t.precioSugerido && ` · sugerido ${money(t.precioSugerido)}`}
            </p>
          </div>
        )}
      </div>

      {/* La ficha a la izquierda y, a la derecha, la caja en 3D y las fotos. */}
      <div className="flex flex-col gap-3 pl-7 @xl:flex-row @xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {renglones.length > 0 && (
            <dl className="grid gap-x-4 gap-y-1 text-sm @sm:grid-cols-[auto_1fr]">
              {renglones.map((r) => (
                <div key={r.etiqueta} className="contents">
                  <dt className="text-muted-foreground">{r.etiqueta}</dt>
                  <dd className="whitespace-pre-line">{r.valor}</dd>
                </div>
              ))}
            </dl>
          )}

          {!sinMaterial && (t.materiales.length > 0 || usados) && (
            <div className="bg-muted/30 rounded-lg border px-3 py-2 text-sm">
              <p className="text-xs font-medium">
                {usados ? "Material usado" : "Material estimado"}
                {!usados && t.reservar && (
                  <span className="text-muted-foreground font-normal"> · se reserva al confirmar</span>
                )}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {(usados ?? t.materiales).map((m) => (
                  <li key={m.productoId} className="flex flex-wrap items-baseline gap-x-2">
                    {m.codigo && <span className="font-mono text-xs">{m.codigo}</span>}
                    <span className="min-w-0 flex-1">{m.nombre}</span>
                    <span className="tnum">{cantidadDeMaterial(m)}</span>
                  </li>
                ))}
                {usados?.length === 0 && <li className="text-muted-foreground">Nada del almacén.</li>}
              </ul>
              {usados && t.materiales.length > 0 && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Estimado: {t.materiales.map((m) => `${cantidadDeMaterial(m)} de ${m.codigo ?? m.nombre}`).join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
        <Carrusel
          diapositivas={vistas}
          etiqueta={`Vistas de ${t.nombre}`}
          className="bg-muted/30 order-first w-full shrink-0 border @xl:order-none @xl:w-60"
        />
      </div>

      {t.corte && (
        <details className="ml-7 rounded-lg border px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">Cortes y acomodo en la plancha</summary>
          <CortesTerminado
            piezas={t.corte.piezas}
            formato={t.corte.formato}
            planchas={t.corte.planchas}
            className="mt-2"
          />
        </details>
      )}

    </div>
  );
}
