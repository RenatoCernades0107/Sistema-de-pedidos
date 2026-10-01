"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import {
  LUGARES,
  PRODUCTOS,
  TIPOS,
  UBICACIONES,
  etiquetaTipos,
  saldoDe,
  type Pedido,
} from "@/lib/dominio";
import {
  cantidadCorta,
  diaMes,
  diaMesTexto,
  fechaCompleta,
  haceCuanto,
  money,
  urgenciaDe,
} from "@/lib/formato";
import { EstadoBadge } from "@/components/estado-badge";
import { Badge } from "@/components/ui/badge";

const CLASE_URGENCIA = {
  vencido: "text-st-observado font-medium",
  hoy: "text-st-en_transito font-medium",
  proximo: "text-foreground",
  normal: "text-muted-foreground",
  cerrado: "text-muted-foreground",
} as const;

/* Fondos opacos para la columna fija: lo que se desliza por debajo no debe
   transparentarse. Son los mismos tonos que el encabezado y el hover de fila. */
const FONDO_FIJO_TH = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]";
const FONDO_FIJO_TD =
  "bg-card group-hover/fila:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))] group-focus-within/fila:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]";

type Meta = { alineado?: "derecha"; fija?: boolean } | undefined;

/**
 * `conAño`: en el historial conviven pedidos de distintos años, y "24 ago"
 * sin más sería ambiguo.
 */
export function PedidosTabla({
  pedidos,
  conAño = false,
}: {
  pedidos: Pedido[];
  conAño?: boolean;
}) {
  const { permisos } = useStore();
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<Pedido>[]>(() => {
    const cols: ColumnDef<Pedido>[] = [
      {
        accessorKey: "codigo",
        header: "Código",
        meta: { fija: true },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {/* Enlace real (teclado, lector de pantalla). Como la celda es
                sticky, su ::after solo cubre la celda; el resto de la fila lo
                cubre el enlace espejo de la columna Registrado. */}
            <Link
              href={`/pedidos/${row.original.codigo}`}
              className="text-primary after:absolute after:inset-0 text-xs font-medium tracking-tight tabular-nums whitespace-nowrap focus-visible:outline-none"
            >
              {row.original.codigo}
            </Link>
            {row.original.esProvincia && (
              <Badge
                variant="outline"
                className="text-st-en_transito border-st-en_transito/30 bg-st-en_transito-soft text-2xs px-1.5 py-0 font-semibold tracking-wide"
              >
                PROV
              </Badge>
            )}
          </div>
        ),
      },
      {
        // Lejos de "Prometida" y con otro formato ("24 ago", no "24/08") para
        // que nadie confunda cuándo entró el pedido con cuándo se entrega.
        accessorKey: "fechaCreacion",
        header: "Registrado",
        cell: ({ row }) => {
          const p = row.original;
          return (
            <>
              {/* Enlace espejo: hace clicable toda la fila, incluido abrir en
                  pestaña nueva. Fuera del orden de tabulación para no
                  duplicar el enlace del código. */}
              <Link
                href={`/pedidos/${p.codigo}`}
                tabIndex={-1}
                aria-hidden
                className="absolute inset-0"
              />
              <span
                className="text-muted-foreground block whitespace-nowrap"
                title={`Registrado el ${fechaCompleta(p.fechaCreacion)}`}
              >
                {diaMesTexto(p.fechaCreacion, conAño)}
                <span className="text-muted-foreground/70 block text-xs">
                  {haceCuanto(p.fechaCreacion)}
                </span>
              </span>
            </>
          );
        },
      },
      {
        id: "tipos",
        accessorFn: (p) => etiquetaTipos(p.tipos),
        header: "Trabajo",
        cell: ({ row }) => {
          const p = row.original;
          const [primero, ...resto] = p.tipos;
          return (
            <div className="min-w-0">
              {/* Con varios tipos solo cabe el primero; el resto va como "+N"
                  y el desglose completo está en el detalle. */}
              <span className="block truncate" title={etiquetaTipos(p.tipos)}>
                {TIPOS[primero]}
                {resto.length > 0 && (
                  <span className="text-muted-foreground ml-1 text-xs">+{resto.length}</span>
                )}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                <span className="tnum">{cantidadCorta(p)}</span>
                {p.producto ? ` · ${PRODUCTOS[p.producto]}` : ""}
              </span>
            </div>
          );
        },
      },
      {
        id: "entrega",
        accessorFn: (p) => LUGARES[p.entrega],
        header: "Entrega",
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="min-w-0">
              <span className="block truncate">{LUGARES[p.entrega]}</span>
              {p.envio && (
                <span className="text-muted-foreground block truncate text-xs">
                  {p.envio.departamento}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "ubicacion",
        accessorFn: (p) => UBICACIONES[p.ubicacion],
        header: "Ubicación",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {UBICACIONES[row.original.ubicacion]}
          </span>
        ),
      },
      {
        accessorKey: "responsable",
        header: "Responsable",
        cell: ({ row }) =>
          row.original.responsable ? (
            <span>{row.original.responsable}</span>
          ) : (
            <span className="text-muted-foreground/70 whitespace-nowrap">Sin asignar</span>
          ),
      },
      {
        accessorKey: "estado",
        header: "Estado",
        cell: ({ row }) => (
          <EstadoBadge estado={row.original.estado} size="sm" />
        ),
      },
      {
        accessorKey: "fechaPrometida",
        header: "Prometida",
        cell: ({ row }) => {
          const u = urgenciaDe(row.original);
          return (
            <span className={cn("tnum whitespace-nowrap", CLASE_URGENCIA[u])}>
              {(conAño ? fechaCompleta : diaMes)(row.original.fechaPrometida)}
              {u === "vencido" && " · vencido"}
              {u === "hoy" && " · hoy"}
            </span>
          );
        },
      },
    ];

    // El cliente es dato comercial: la columna no existe para quien no lo ve.
    if (permisos.verCliente) {
      cols.splice(2, 0, {
        accessorKey: "cliente",
        header: "Cliente",
        cell: ({ row }) => (
          <span className="block max-w-[22ch] truncate font-medium xl:max-w-[30ch]">
            {row.original.cliente}
          </span>
        ),
      });
    }

    if (permisos.verMontos) {
      cols.push({
        id: "saldo",
        accessorFn: (p) => saldoDe(p),
        header: "Saldo",
        meta: { alineado: "derecha" },
        cell: ({ row }) => {
          const saldo = saldoDe(row.original);
          return saldo > 0 ? (
            <span className="tnum text-saldo-alerta parpadeo-alerta font-bold whitespace-nowrap">
              {money(saldo)}
            </span>
          ) : (
            <span className="text-muted-foreground">Pagado</span>
          );
        },
      });
    }

    return cols;
  }, [permisos.verCliente, permisos.verMontos, conAño]);

  const table = useReactTable({
    data: pedidos,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const tablaRef = useRef<HTMLTableElement>(null);
  const [desborde, setDesborde] = useState({
    izq: false,
    der: false,
    // Fracción visible del ancho total: da el largo del pulgar de la barra.
    visible: 1,
  });

  const medir = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const siguiente = {
      izq: el.scrollLeft > 1,
      der: el.scrollLeft < max - 1,
      visible: el.scrollWidth ? el.clientWidth / el.scrollWidth : 1,
    };
    setDesborde((prev) =>
      prev.izq === siguiente.izq &&
      prev.der === siguiente.der &&
      prev.visible === siguiente.visible
        ? prev
        : siguiente,
    );
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const tabla = tablaRef.current;
    if (!el || !tabla) return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    ro.observe(tabla);
    medir();
    return () => ro.disconnect();
  }, [medir]);

  const hayDesborde = desborde.izq || desborde.der;

  return (
    // overflow-clip, no hidden: hidden convierte la tarjeta en contenedor de
    // scroll y la barra sticky de abajo dejaría de pegarse a la ventana.
    <div className="bg-card overflow-clip rounded-xl border">
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={medir}
          // La barra nativa queda debajo de la última fila, donde nadie la
          // ve; se oculta y en su lugar va la barra fija de abajo.
          className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <table ref={tablaRef} className="w-full border-collapse text-sm">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b">
                  {hg.headers.map((h) => {
                    const meta = h.column.columnDef.meta as Meta;
                    const derecha = meta?.alineado === "derecha";
                    const orden = h.column.getIsSorted();
                    return (
                      <th
                        key={h.id}
                        scope="col"
                        className={cn(
                          "bg-muted/40 px-3 py-2 text-left font-medium whitespace-nowrap",
                          derecha && "text-right",
                          meta?.fija && [
                            "sticky left-0 z-10 transition-shadow",
                            FONDO_FIJO_TH,
                            desborde.izq && SOMBRA_FIJA,
                          ],
                        )}
                      >
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className={cn(
                            "eyebrow hover:text-foreground -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors",
                            "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                            derecha && "flex-row-reverse",
                            orden && "text-foreground",
                          )}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {orden === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : orden === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover/th:opacity-40" />
                          )}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="group/fila hover:bg-muted/50 focus-within:bg-muted/50 focus-within:ring-ring/40 relative border-b transition-colors last:border-0 focus-within:ring-2 focus-within:ring-inset"
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as Meta;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "px-3 py-2.5 align-middle",
                          meta?.alineado === "derecha" && "text-right",
                          meta?.fija && [
                            "sticky left-0 z-10 transition-[background-color,box-shadow]",
                            FONDO_FIJO_TD,
                            desborde.izq && SOMBRA_FIJA,
                          ],
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Degradado a la derecha: avisa que hay más columnas sin decirlo. */}
        <div
          aria-hidden
          className={cn(
            "from-card pointer-events-none absolute inset-y-0 right-0 z-20 w-12 bg-linear-to-l to-transparent transition-opacity duration-200",
            desborde.der ? "opacity-100" : "opacity-0",
          )}
        />
      </div>

      {hayDesborde && (
        <BarraDesplazamiento scrollRef={scrollRef} desborde={desborde} />
      )}
    </div>
  );
}

/**
 * Sombra y línea en el borde derecho de la columna fija mientras algo pasa por
 * debajo. La línea es la que se ve en modo oscuro, donde la sombra no.
 */
const SOMBRA_FIJA =
  "shadow-[1px_0_0_var(--border),8px_0_12px_-8px_rgb(0_0_0/0.25)]";

/**
 * Barra pegada al borde inferior de la ventana mientras la tabla esté a la
 * vista. Es propia y no nativa: la nativa de Windows trae sus propias flechas,
 * que se duplicarían con los botones, y no se puede estilizar en Chrome.
 * El pulgar se mueve escribiendo el transform directo, sin estado: así
 * desplazar no vuelve a renderizar las filas en cada frame.
 */
function BarraDesplazamiento({
  scrollRef,
  desborde,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  desborde: { izq: boolean; der: boolean; visible: number };
}) {
  const pistaRef = useRef<HTMLDivElement>(null);
  const pulgarRef = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ x: number; inicio: number } | null>(null);

  /** Cuántos píxeles de tabla equivale cada píxel de pista. */
  const escala = () => {
    const el = scrollRef.current;
    const pista = pistaRef.current;
    const pulgar = pulgarRef.current;
    if (!el || !pista || !pulgar) return null;
    const max = el.scrollWidth - el.clientWidth;
    const libre = pista.clientWidth - pulgar.offsetWidth;
    return { el, max, libre };
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mover = () => {
      const e = escala();
      if (!e || !pulgarRef.current) return;
      const x = e.max > 0 ? (e.el.scrollLeft / e.max) * e.libre : 0;
      pulgarRef.current.style.transform = `translateX(${x}px)`;
    };
    mover();
    el.addEventListener("scroll", mover, { passive: true });
    const ro = new ResizeObserver(mover);
    if (pistaRef.current) ro.observe(pistaRef.current);
    return () => {
      el.removeEventListener("scroll", mover);
      ro.disconnect();
    };
    // escala solo lee refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, desborde.visible]);

  const desplazar = (sentido: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: sentido * el.clientWidth * 0.6, behavior: "smooth" });
  };

  return (
    <div className="bg-card/90 sticky bottom-0 z-20 flex items-center gap-1 border-t px-1.5 py-1 backdrop-blur-md">
      <BotonDesplazar
        sentido={-1}
        activo={desborde.izq}
        onClick={() => desplazar(-1)}
      />
      {/* Solo para el ratón: con teclado están los botones. */}
      <div
        aria-hidden
        className="group/pista flex h-7 min-w-0 flex-1 cursor-pointer items-center px-1"
        onPointerDown={(ev) => {
          // Clic en la pista: el pulgar salta centrado donde se hizo clic.
          if (ev.target === pulgarRef.current) return;
          const e = escala();
          const pista = pistaRef.current;
          if (!e || !pista || e.libre <= 0) return;
          const r = pista.getBoundingClientRect();
          const ancho = pulgarRef.current!.offsetWidth;
          const frac = (ev.clientX - r.left - ancho / 2) / e.libre;
          e.el.scrollTo({
            left: Math.min(Math.max(frac, 0), 1) * e.max,
            behavior: "smooth",
          });
        }}
      >
        <div
          ref={pistaRef}
          className="bg-muted relative h-1.5 w-full rounded-full transition-[height] group-hover/pista:h-2"
        >
          <div
            ref={pulgarRef}
            onPointerDown={(ev) => {
              const el = scrollRef.current;
              if (!el) return;
              ev.preventDefault();
              ev.currentTarget.setPointerCapture(ev.pointerId);
              arrastre.current = { x: ev.clientX, inicio: el.scrollLeft };
            }}
            onPointerMove={(ev) => {
              const e = escala();
              if (!arrastre.current || !e || e.libre <= 0) return;
              e.el.scrollLeft =
                arrastre.current.inicio +
                ((ev.clientX - arrastre.current.x) * e.max) / e.libre;
            }}
            onPointerUp={() => (arrastre.current = null)}
            onPointerCancel={() => (arrastre.current = null)}
            className="bg-muted-foreground/40 hover:bg-muted-foreground/70 active:bg-muted-foreground/80 absolute inset-y-0 left-0 min-w-10 cursor-grab rounded-full transition-colors active:cursor-grabbing"
            style={{ width: `${desborde.visible * 100}%` }}
          />
        </div>
      </div>
      <BotonDesplazar
        sentido={1}
        activo={desborde.der}
        onClick={() => desplazar(1)}
      />
    </div>
  );
}

function BotonDesplazar({
  sentido,
  activo,
  onClick,
}: {
  sentido: 1 | -1;
  activo: boolean;
  onClick: () => void;
}) {
  const Icono = sentido === 1 ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!activo}
      aria-label={
        sentido === 1
          ? "Ver columnas a la derecha"
          : "Ver columnas a la izquierda"
      }
      className={cn(
        "text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 shrink-0 place-items-center rounded-md transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-30",
      )}
    >
      <Icono className="size-4" />
    </button>
  );
}
