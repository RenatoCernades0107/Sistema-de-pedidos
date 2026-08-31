"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
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
import { cantidadCorta, diaMes, money, urgenciaDe } from "@/lib/formato";
import { EstadoBadge } from "@/components/estado-badge";
import { Badge } from "@/components/ui/badge";

const CLASE_URGENCIA = {
  vencido: "text-st-observado font-medium",
  hoy: "text-st-en_transito font-medium",
  proximo: "text-foreground",
  normal: "text-muted-foreground",
  cerrado: "text-muted-foreground",
} as const;

export function PedidosTabla({ pedidos }: { pedidos: Pedido[] }) {
  const { permisos } = useStore();
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<Pedido>[]>(() => {
    const cols: ColumnDef<Pedido>[] = [
      {
        accessorKey: "codigo",
        header: "Código",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {/* El enlace cubre toda la fila: clic, teclado, y abrir en pestaña nueva */}
            <Link
              href={`/pedidos/${row.original.codigo}`}
              className="text-primary after:absolute after:inset-0 text-xs font-medium tracking-tight tabular-nums focus-visible:outline-none"
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
            <span className="text-muted-foreground/70">Sin asignar</span>
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
              {diaMes(row.original.fechaPrometida)}
              {u === "vencido" && " · vencido"}
              {u === "hoy" && " · hoy"}
            </span>
          );
        },
      },
    ];

    // El cliente es dato comercial: la columna no existe para quien no lo ve.
    if (permisos.verCliente) {
      cols.splice(1, 0, {
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
            <span className="tnum text-saldo-alerta parpadeo-alerta font-bold">
              {money(saldo)}
            </span>
          ) : (
            <span className="text-muted-foreground">Pagado</span>
          );
        },
      });
    }

    return cols;
  }, [permisos.verCliente, permisos.verMontos]);

  const table = useReactTable({
    data: pedidos,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b">
                {hg.headers.map((h) => {
                  const derecha =
                    (
                      h.column.columnDef.meta as
                        { alineado?: string } | undefined
                    )?.alineado === "derecha";
                  const orden = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      className={cn(
                        "bg-muted/40 px-3 py-2 text-left font-medium whitespace-nowrap",
                        derecha && "text-right",
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
                className="hover:bg-muted/50 focus-within:bg-muted/50 focus-within:ring-ring/40 relative border-b transition-colors last:border-0 focus-within:ring-2 focus-within:ring-inset"
              >
                {row.getVisibleCells().map((cell) => {
                  const derecha =
                    (
                      cell.column.columnDef.meta as
                        { alineado?: string } | undefined
                    )?.alineado === "derecha";
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-3 py-2.5 align-middle",
                        derecha && "text-right",
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
    </div>
  );
}
