"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Archive,
  CalendarRange,
  LayoutGrid,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { HOY } from "@/lib/datos";
import {
  ESTADOS,
  ORDEN_ESTADOS,
  TIPOS,
  TRABAJADORES,
  VISTAS,
  esTerminal,
  fechaCierreDe,
  sumarDias,
  type Estado,
  type TipoPedido,
  type Vista,
} from "@/lib/dominio";
import { camposBuscables, coincide } from "@/lib/busqueda";
import { cerradoHoy, porCierre, porUrgencia } from "@/lib/formato";
import { BARRA_ESTADO } from "@/components/estado-badge";
import { PedidoCard } from "@/components/pedido-card";
import { PedidosKanban } from "@/components/pedidos-kanban";
import { PedidosTabla } from "@/components/pedidos-tabla";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Modo = "lista" | "kanban";
type Rango = "7" | "30" | "90" | "todo";

const RANGOS: Record<Rango, string> = {
  "7": "Últimos 7 días",
  "30": "Últimos 30 días",
  "90": "Últimos 90 días",
  todo: "Todo el historial",
};

export function VistaPedidos({ vista }: { vista: Vista }) {
  const { pedidos, permisos } = useStore();
  const [modo, setModo] = useState<Modo>("lista");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<Estado | "todos">("todos");
  const [tipo, setTipo] = useState<TipoPedido | "todos">("todos");
  const [responsable, setResponsable] = useState<string>("todos");
  const [rango, setRango] = useState<Rango>("todo");

  const config = VISTAS[vista];
  const esArchivo = !!config.archivo;

  /**
   * Un pedido entregado o anulado deja de estorbar la lista al día siguiente:
   * a partir de ahí solo se encuentra en el historial.
   */
  const base = useMemo(() => {
    const propios = pedidos.filter(config.filtro);
    return esArchivo ? propios : propios.filter((p) => !esTerminal(p.estado) || cerradoHoy(p));
  }, [pedidos, config, esArchivo]);

  /** Los cerrados que ya salieron de las listas y viven solo en el historial. */
  const enHistorial = useMemo(
    () => pedidos.filter((p) => esTerminal(p.estado)).length,
    [pedidos],
  );

  const filtrados = useMemo(() => {
    const desde = rango === "todo" ? null : sumarDias(HOY, -Number(rango));
    return base
      .filter((p) => {
        if (estado !== "todos" && p.estado !== estado) return false;
        if (tipo !== "todos" && !p.tipos.includes(tipo)) return false;
        if (responsable !== "todos") {
          if (responsable === "sin" ? p.responsable !== null : p.responsable !== responsable)
            return false;
        }
        if (desde) {
          const cierre = fechaCierreDe(p);
          if (!cierre || cierre < desde) return false;
        }
        if (!coincide(camposBuscables(p, permisos), q)) return false;
        return true;
      })
      .sort(esArchivo ? porCierre : porUrgencia);
  }, [base, estado, tipo, responsable, q, rango, esArchivo, permisos]);

  const conteos = useMemo(() => {
    const m = new Map<Estado, number>();
    for (const p of base) m.set(p.estado, (m.get(p.estado) ?? 0) + 1);
    return m;
  }, [base]);

  const chips = config.estadosChip ?? ORDEN_ESTADOS;

  const hayFiltros =
    q !== "" ||
    estado !== "todos" ||
    tipo !== "todos" ||
    responsable !== "todos" ||
    rango !== "todo";
  const limpiar = () => {
    setQ("");
    setEstado("todos");
    setTipo("todos");
    setResponsable("todos");
    setRango("todo");
  };

  if (!permisos.vistas.includes(vista)) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Esta vista no es para tu rol</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {permisos.nombre} no tiene acceso a {config.titulo}. Cambia de rol arriba a la
            derecha para comprobar los permisos.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{config.titulo}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {config.descripcion} ·{" "}
            <span className="tnum text-foreground font-medium">{filtrados.length}</span> de{" "}
            <span className="tnum">{base.length}</span>
          </p>
        </div>
        <div className="flex-1" />
        {/* Lo cerrado no se pierde: está a un clic, con su propio buscador. */}
        {!esArchivo && permisos.vistas.includes("historial") && (
          <Button
            render={<Link href="/historial" />}
            nativeButton={false}
            variant="outline"
            className="gap-1.5"
          >
            <Archive className="size-4" />
            Ver historial
            <span className="tnum text-muted-foreground">{enHistorial}</span>
          </Button>
        )}
        {permisos.crearPedido && (
          <Button
            render={<Link href="/pedidos/nuevo" />}
            nativeButton={false}
            className="gap-1.5 max-md:hidden"
          >
            <Plus className="size-4" />
            Nuevo pedido
          </Button>
        )}
      </header>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              permisos.verCliente
                ? "Buscar código, cliente o responsable…"
                : "Buscar código, trabajo o responsable…"
            }
            className="h-9 pl-8.5"
            aria-label="Buscar pedidos"
          />
        </div>

        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoPedido | "todos")}>
          <SelectTrigger size="sm" className="w-auto min-w-[9.5rem]" aria-label="Tipo de pedido">
            <SlidersHorizontal className="text-muted-foreground size-3.5" />
            <SelectValue>{tipo === "todos" ? "Todos los tipos" : TIPOS[tipo]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los tipos</SelectItem>
            {(Object.keys(TIPOS) as TipoPedido[]).map((t) => (
              <SelectItem key={t} value={t}>
                {TIPOS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={responsable} onValueChange={(v) => setResponsable(v ?? "todos")}>
          <SelectTrigger size="sm" className="w-auto min-w-[8.5rem]" aria-label="Responsable">
            <SelectValue>
              {responsable === "todos"
                ? "Todo el taller"
                : responsable === "sin"
                  ? "Sin asignar"
                  : responsable}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todo el taller</SelectItem>
            {TRABAJADORES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
            <SelectItem value="sin">Sin asignar</SelectItem>
          </SelectContent>
        </Select>

        {/* El archivo crece sin parar: sin un rango, buscar en él es peor que útil. */}
        {esArchivo && (
          <Select value={rango} onValueChange={(v) => setRango((v as Rango) ?? "todo")}>
            <SelectTrigger
              size="sm"
              className="w-auto min-w-[10rem]"
              aria-label="Rango de fechas de cierre"
            >
              <CalendarRange className="text-muted-foreground size-3.5" />
              <SelectValue>{RANGOS[rango]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(RANGOS) as Rango[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {RANGOS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <AnimatePresence>
          {hayFiltros && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.12 }}
            >
              <Button variant="ghost" size="sm" onClick={limpiar} className="gap-1.5">
                <X className="size-3.5" />
                Limpiar
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="ml-auto flex rounded-lg border p-0.5">
          {(["lista", "kanban"] as Modo[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              aria-pressed={modo === m}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                modo === m
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "lista" ? <List className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
              <span className="max-sm:sr-only">{m === "lista" ? "Lista" : "Kanban"}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Chips de estado */}
      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6">
        <Chip activo={estado === "todos"} onClick={() => setEstado("todos")} total={base.length}>
          Todos
        </Chip>
        {chips.map((e) => (
          <Chip
            key={e}
            activo={estado === e}
            onClick={() => setEstado(estado === e ? "todos" : e)}
            total={conteos.get(e) ?? 0}
            punto={BARRA_ESTADO[e]}
          >
            {ESTADOS[e]}
          </Chip>
        ))}
      </div>

      {filtrados.length === 0 ? (
        <div className="bg-card grid place-items-center rounded-xl border py-16 text-center">
          <Search className="text-muted-foreground/40 size-6" />
          <p className="mt-3 text-sm font-medium">Ningún pedido coincide</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Prueba con otro término o quita los filtros.
          </p>
          {hayFiltros && (
            <Button variant="outline" size="sm" onClick={limpiar} className="mt-4">
              Limpiar filtros
            </Button>
          )}
        </div>
      ) : modo === "kanban" ? (
        <PedidosKanban pedidos={filtrados} />
      ) : (
        <>
          <div className="max-md:hidden">
            <PedidosTabla pedidos={filtrados} />
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {filtrados.map((p) => (
              <PedidoCard key={p.codigo} pedido={p} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Chip({
  activo,
  onClick,
  total,
  punto,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  total: number;
  punto?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        activo
          ? "border-foreground/15 bg-foreground/[0.06] text-foreground font-medium"
          : "text-muted-foreground hover:text-foreground hover:border-foreground/15",
      )}
    >
      {punto && <span className={cn("size-1.5 rounded-full", punto)} aria-hidden />}
      {children}
      <span className="tnum text-muted-foreground">{total}</span>
    </button>
  );
}
