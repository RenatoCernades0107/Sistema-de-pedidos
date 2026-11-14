"use client";

import { CircleAlert, TriangleAlert } from "lucide-react";
import { medida } from "@/lib/cad/esquema";
import type { PiezaCad, ValidacionCad } from "@/lib/cad/tipos";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** mm² → cm², que es como se habla de áreas de plancha en el taller. */
const cm2 = (mm2: number) => (mm2 / 100).toLocaleString("es-PE", { maximumFractionDigits: 1 });
const metros = (mm: number) => (mm / 1000).toLocaleString("es-PE", { maximumFractionDigits: 2 });

/**
 * El despiece: cada pieza acostada con su caja envolvente. Pasar el cursor por
 * una fila la resalta en el visor, y al revés.
 */
export function ListaPiezas({
  piezas,
  validaciones,
  piezaActiva,
  alCambiarPieza,
}: {
  piezas: PiezaCad[];
  validaciones: ValidacionCad[];
  piezaActiva: string | null;
  alCambiarPieza: (id: string | null) => void;
}) {
  if (piezas.length === 0) {
    return <p className="text-muted-foreground text-sm">Este diseño no tiene piezas.</p>;
  }

  const total = piezas.reduce((n, p) => n + p.cantidad, 0);
  const area = piezas.reduce((n, p) => n + p.area_mm2 * p.cantidad, 0);
  const corte = piezas.reduce((n, p) => n + p.perimetro_mm * p.cantidad, 0);
  const nivelDe = (id: string) => {
    const suyas = validaciones.filter((v) => v.pieza === id);
    if (suyas.some((v) => v.nivel === "error")) return "error";
    return suyas.length ? "aviso" : null;
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pieza</TableHead>
          <TableHead className="text-right">Cant.</TableHead>
          <TableHead className="text-right">Espesor</TableHead>
          <TableHead className="text-right">Ancho × alto</TableHead>
          <TableHead className="text-right">Área</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {piezas.map((p) => {
          const nivel = nivelDe(p.id);
          const activa = p.id === piezaActiva;
          return (
            <TableRow
              key={p.id}
              data-pieza={p.id}
              data-state={activa ? "selected" : undefined}
              aria-selected={activa}
              tabIndex={0}
              onMouseEnter={() => alCambiarPieza(p.id)}
              onMouseLeave={() => alCambiarPieza(null)}
              onFocus={() => alCambiarPieza(p.id)}
              onBlur={() => alCambiarPieza(null)}
              onClick={() => alCambiarPieza(activa ? null : p.id)}
              className={cn(
                "focus-visible:ring-ring/50 cursor-default outline-none focus-visible:ring-2",
                activa && "bg-primary/[0.06]",
              )}
            >
              <TableCell className="font-medium">
                <span className="inline-flex items-center gap-1.5">
                  {p.nombre}
                  {nivel === "error" && (
                    <CircleAlert className="text-destructive size-3.5" aria-label="Tiene errores" />
                  )}
                  {nivel === "aviso" && (
                    <TriangleAlert className="text-st-observado size-3.5" aria-label="Tiene avisos" />
                  )}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{p.cantidad}</TableCell>
              <TableCell className="text-right tabular-nums">{medida(p.espesor_mm)} mm</TableCell>
              <TableCell className="text-right tabular-nums">
                {medida(p.ancho_mm)} × {medida(p.alto_mm)} mm
              </TableCell>
              <TableCell className="text-right tabular-nums">{cm2(p.area_mm2)} cm²</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell className="text-right tabular-nums">{total}</TableCell>
          <TableCell colSpan={2} className="text-muted-foreground text-right font-normal tabular-nums">
            {metros(corte)} m de corte
          </TableCell>
          <TableCell className="text-right tabular-nums">{cm2(area)} cm²</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/**
 * Lo que el motor encontró al revisar el diseño. Un `error` significa que no se
 * debe mandar a producción; un `aviso`, que conviene mirarlo.
 */
export function ListaValidaciones({
  validaciones,
  piezas,
  piezaActiva,
  alCambiarPieza,
}: {
  validaciones: ValidacionCad[];
  piezas: PiezaCad[];
  piezaActiva: string | null;
  alCambiarPieza: (id: string | null) => void;
}) {
  if (validaciones.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Sin observaciones: el diseño pasa todas las comprobaciones del motor.
      </p>
    );
  }

  const nombreDe = (id: string) => piezas.find((p) => p.id === id)?.nombre ?? id;
  // Los errores primero: son los que impiden producir.
  const ordenadas = [...validaciones].sort(
    (a, b) => Number(b.nivel === "error") - Number(a.nivel === "error"),
  );

  return (
    <ul className="flex flex-col gap-2">
      {ordenadas.map((v, n) => {
        const esError = v.nivel === "error";
        const Icono = esError ? CircleAlert : TriangleAlert;
        const pieza = v.pieza;
        return (
          <li
            key={`${v.codigo}-${pieza ?? ""}-${n}`}
            onMouseEnter={pieza ? () => alCambiarPieza(pieza) : undefined}
            onMouseLeave={pieza ? () => alCambiarPieza(null) : undefined}
            className={cn(
              "flex gap-2.5 rounded-lg border px-3 py-2 text-sm",
              esError
                ? "border-destructive/30 bg-destructive/[0.06]"
                : "border-st-observado/25 bg-st-observado-soft",
              pieza && pieza === piezaActiva && "ring-ring/40 ring-2",
            )}
          >
            <Icono
              className={cn("mt-0.5 size-4 shrink-0", esError ? "text-destructive" : "text-st-observado")}
              aria-hidden
            />
            <div className="min-w-0">
              <p>
                <span className="font-medium">{esError ? "Error" : "Aviso"}</span>
                {pieza && <span className="text-muted-foreground"> · {nombreDe(pieza)}</span>}
              </p>
              <p className="text-foreground/80">{v.mensaje}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
