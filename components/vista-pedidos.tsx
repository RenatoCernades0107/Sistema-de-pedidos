"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { hoy } from "@/lib/fecha";
import {
  ALCANCES,
  ESTADOS,
  ORDEN_ESTADOS,
  TIPOS,
  alcanceDe,
  esTerminal,
  fechaCierreDe,
  rutaAlcance,
  sumarDias,
  type Alcance,
  type Estado,
  type TipoPedido,
} from "@/lib/dominio";
import { camposBuscables, coincide } from "@/lib/busqueda";
import { porUrgencia } from "@/lib/formato";
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

/** El rango solo recorta los cerrados, por su fecha de cierre: un activo pasa siempre. */
const RANGOS: Record<Rango, string> = {
  "7": "Cerrados: 7 días",
  "30": "Cerrados: 30 días",
  "90": "Cerrados: 90 días",
  todo: "Cerrados: todos",
};

/** Pedidos por página en la lista. Los cerrados, al fondo, caen en las últimas. */
const POR_PAGINA = 50;

/**
 * La única vista de pedidos. El alcance (Todos, Míos, Taller, Tienda, Logística)
 * vive en `?ver=` para que una recarga o un enlace compartido abran lo mismo; se
 * escribe con `replaceState`, que Next sincroniza con `useSearchParams` sin ir al
 * servidor.
 *
 * Los cerrados no tienen vista propia: van mezclados, al final del orden.
 */
export function VistaPedidos() {
  const { pedidos, permisos, trabajadores } = useStore();
  const params = useSearchParams();
  const alcance = alcanceDe(permisos, params.get("ver"));
  const [modo, setModo] = useState<Modo>("kanban");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<Estado | "todos">("todos");
  const [tipo, setTipo] = useState<TipoPedido | "todos">("todos");
  const [responsable, setResponsable] = useState<string>("todos");
  const [rango, setRango] = useState<Rango>("todo");
  const [pagina, setPagina] = useState(1);

  // Cualquier cambio de filtro vuelve a la primera página. Se ajusta durante el
  // render, no en un efecto, para no pintar una página vacía entre medio.
  const firma = [alcance, q, estado, tipo, responsable, rango, modo].join("|");
  const [firmaPrevia, setFirmaPrevia] = useState(firma);
  if (firma !== firmaPrevia) {
    setFirmaPrevia(firma);
    setPagina(1);
  }

  const elegirAlcance = (a: Alcance) => {
    window.history.replaceState(null, "", rutaAlcance(permisos, a));
  };

  const config = ALCANCES[alcance];

  /** Lo que le toca al rol, sin filtro de alcance: de aquí salen los contadores. */
  const delRol = useMemo(() => pedidos.filter(permisos.base), [pedidos, permisos]);

  const activosPorAlcance = useMemo(() => {
    const m = new Map<Alcance, number>();
    for (const a of permisos.alcances) {
      m.set(a, delRol.filter((p) => !esTerminal(p.estado) && ALCANCES[a].filtro(p)).length);
    }
    return m;
  }, [delRol, permisos.alcances]);

  const base = useMemo(() => delRol.filter(config.filtro), [delRol, config]);

  const filtrados = useMemo(() => {
    const desde = rango === "todo" ? null : sumarDias(hoy(), -Number(rango));
    return base
      .filter((p) => {
        if (estado !== "todos" && p.estado !== estado) return false;
        if (tipo !== "todos" && !p.tipos.includes(tipo)) return false;
        if (responsable !== "todos") {
          if (responsable === "sin" ? p.responsable !== null : p.responsable !== responsable)
            return false;
        }
        if (desde && esTerminal(p.estado)) {
          const cierre = fechaCierreDe(p);
          if (!cierre || cierre < desde) return false;
        }
        if (!coincide(camposBuscables(p, permisos), q)) return false;
        return true;
      })
      .sort(porUrgencia);
  }, [base, estado, tipo, responsable, q, rango, permisos]);

  const conteos = useMemo(() => {
    const m = new Map<Estado, number>();
    for (const p of base) m.set(p.estado, (m.get(p.estado) ?? 0) + 1);
    return m;
  }, [base]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const enPagina = filtrados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);
  // "24 ago" es ambiguo en cuanto asoma un pedido de otro año.
  const año = hoy().slice(0, 4);
  const conAño = enPagina.some((p) => p.fechaPrometida.slice(0, 4) !== año);

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

  const irAPagina = (n: number) => {
    setPagina(n);
    document.getElementById("contenido")?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Pedidos</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {config.descripcion} ·{" "}
            <span className="tnum text-foreground font-medium">{filtrados.length}</span> de{" "}
            <span className="tnum">{base.length}</span>
          </p>
        </div>
        <div className="flex-1" />
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

      {/* Alcance: antes eran vistas separadas en el menú. Con uno solo (el taller)
          no hay nada que elegir. El número cuenta solo lo abierto. */}
      {permisos.alcances.length > 1 && (
        <div
          role="group"
          aria-label="Alcance"
          className="-mx-4 mb-3 flex gap-1 overflow-x-auto px-4 md:-mx-6 md:px-6"
        >
          <div className="flex shrink-0 rounded-lg border p-0.5">
            {permisos.alcances.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => elegirAlcance(a)}
                aria-pressed={alcance === a}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                  alcance === a
                    ? "bg-secondary text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {ALCANCES[a].corto}
                <span className="tnum text-muted-foreground text-xs">
                  {activosPorAlcance.get(a) ?? 0}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* En móvil el buscador ocupa su propia línea: compartiéndola con los dos
            desplegables se quedaba en un campo de un carácter. */}
        <div className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-xs">
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
            {trabajadores.map((t) => (
              <SelectItem key={t.id} value={t.nombre}>
                {t.nombre}
              </SelectItem>
            ))}
            <SelectItem value="sin">Sin asignar</SelectItem>
          </SelectContent>
        </Select>

        {/* Los cerrados crecen sin parar: el rango los recorta sin tocar lo abierto. */}
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
        {ORDEN_ESTADOS.map((e) => (
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
        <PedidosKanban
          pedidos={filtrados}
          alVerTodos={(e) => {
            setEstado(e);
            setModo("lista");
          }}
        />
      ) : (
        <>
          <div className="max-md:hidden">
            <PedidosTabla pedidos={enPagina} conAño={conAño} />
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {enPagina.map((p) => (
              <PedidoCard key={p.codigo} pedido={p} conAño={conAño} />
            ))}
          </ul>
          {totalPaginas > 1 && (
            <Paginacion
              pagina={paginaActual}
              total={totalPaginas}
              desde={(paginaActual - 1) * POR_PAGINA + 1}
              hasta={(paginaActual - 1) * POR_PAGINA + enPagina.length}
              de={filtrados.length}
              irA={irAPagina}
            />
          )}
        </>
      )}
    </div>
  );
}

function Paginacion({
  pagina,
  total,
  desde,
  hasta,
  de,
  irA,
}: {
  pagina: number;
  total: number;
  desde: number;
  hasta: number;
  de: number;
  irA: (n: number) => void;
}) {
  return (
    <nav
      aria-label="Paginación"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-muted-foreground">
        <span className="tnum text-foreground font-medium">
          {desde}–{hasta}
        </span>{" "}
        de <span className="tnum">{de}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => irA(pagina - 1)}
          disabled={pagina <= 1}
          className="gap-1"
        >
          <ChevronLeft className="size-3.5" />
          Anterior
        </Button>
        <span className="tnum text-muted-foreground px-1 text-xs">
          Página {pagina} de {total}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => irA(pagina + 1)}
          disabled={pagina >= total}
          className="gap-1"
        >
          Siguiente
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </nav>
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
