"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, MapPin, Pencil, Plus, Printer, RefreshCw, RotateCw, Search, Warehouse } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import type { Almacen } from "@/lib/almacenes";
import { money } from "@/lib/formato";
import { compactar } from "@/lib/busqueda-inteligente";
import { fechaCompleta } from "@/lib/formato";
import { diaEnLima } from "@/lib/fecha";
import {
  ESTADOS_SOBRANTE,
  cabeEn,
  leerMedidaBuscada,
  medidaSobrante,
  ordenDeUso,
  type Sobrante,
} from "@/lib/sobrantes";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Opciones } from "@/components/ui/campo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DialogoPrecio, type PermisosAlmacen } from "@/components/almacen/comun";
import { DialogoRegistrarSobrante, DialogoUbicacion } from "./dialogos-sobrante";

const TODOS = "__todos";

type Vista = "disponibles" | "todos";

/** Lo que la búsqueda entiende: palabras (material, código, ubicación) y una medida "60x80". */
function filtrar(
  sobrantes: Sobrante[],
  texto: string,
  vista: Vista,
  almacenId: string | null,
): { lista: Sobrante[]; medida: boolean } {
  const pieza = leerMedidaBuscada(texto);
  const palabras = texto
    .replace(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i, " ")
    .split(/\s+/)
    .map(compactar)
    .filter(Boolean);

  const lista = sobrantes.filter((s) => {
    if (vista === "disponibles" && s.estado !== "disponible" && s.estado !== "reservado" && s.estado !== "en_transito") return false;
    if (almacenId && s.almacenId !== almacenId) return false;
    if (pieza && !cabeEn(s, pieza)) return false;
    const donde = compactar(`${s.codigo} ${s.material} ${s.almacen} ${s.ubicacion ?? ""}`);
    return palabras.every((p) => donde.includes(p));
  });
  // Con una medida, primero el que conviene usar: el más chico donde cabe.
  return { lista: pieza ? ordenDeUso(lista) : lista, medida: !!pieza };
}

/**
 * Los sobrantes, en la pestaña del almacén: buscar uno para una pieza (en todos
 * los almacenes o en uno), registrar los que se miden, imprimir su etiqueta y
 * mantener la lista de acuerdo con Odoo.
 */
export function PantallaSobrantes({
  sobrantes,
  catalogo,
  almacenes,
  precios,
  permisos,
  odooConectado,
  alTransferir,
  alReportarBaja,
  alVerHistoria,
}: {
  sobrantes: Sobrante[];
  catalogo: GrupoPlancha[];
  almacenes: Almacen[];
  /** El precio de venta de cada uno, por su código (para quien lo ve). */
  precios: Record<string, number | null>;
  permisos: PermisosAlmacen;
  odooConectado: boolean;
  /** Llevarlo a otro almacén: abre la transferencia con este sobrante. */
  alTransferir?: (s: Sobrante) => void;
  /** Reportar que se rompió o se perdió. */
  alReportarBaja?: (s: Sobrante) => void;
  /** Su historia en Odoo (el kárdex de su lote). */
  alVerHistoria?: (s: Sobrante) => void;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [vista, setVista] = useState<Vista>("disponibles");
  const [almacenId, setAlmacenId] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [moviendo, setMoviendo] = useState<Sobrante | null>(null);
  const [preciando, setPreciando] = useState<Sobrante | null>(null);
  const [sincronizando, iniciarSincronizacion] = useTransition();
  const [reintentando, iniciarReintento] = useTransition();

  const { lista, medida } = useMemo(
    () => filtrar(sobrantes, texto, vista, almacenId),
    [sobrantes, texto, vista, almacenId],
  );
  const conSobrantes = almacenes.filter((a) => a.activo || sobrantes.some((s) => s.almacenId === a.id));
  const elegido = almacenes.find((a) => a.id === almacenId) ?? null;
  const enAlmacen = sobrantes.filter((s) => s.estado === "disponible" || s.estado === "reservado").length;

  const sincronizar = () =>
    iniciarSincronizacion(async () => {
      const r = await acciones.sincronizarSobrantes();
      if (!r.ok) {
        toast.error("No se sincronizó", { description: r.error });
        return;
      }
      const s = r.resumen!;
      const partes = [
        s.traidos && `${s.traidos} traídos de Odoo`,
        s.llevados && `${s.llevados} creados en Odoo`,
        s.agotados && `${s.agotados} ya no están en Odoo`,
      ].filter(Boolean);
      toast.success("Sobrantes al día con Odoo", {
        description: partes.length ? partes.join(" · ") : "No había nada que cambiar.",
      });
      if (s.problemas.length) {
        toast.warning(`${s.problemas.length} sin resolver`, { description: s.problemas.join("\n"), duration: 15_000 });
      }
    });

  const reintentar = (s: Sobrante) =>
    iniciarReintento(async () => {
      const r = await acciones.reintentarSobrante(s.codigo);
      if (r.ok) toast.success(`${s.codigo} creado en Odoo`);
      else toast.error("Odoo no lo creó", { description: r.error });
    });

  return (
    <div>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start">
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">
          Los pedazos de plancha que quedan en cada almacén. Busca por material o por la medida que necesitas
          (<span className="font-mono">60x80</span>) y aparecen primero los que conviene usar.
        </p>
        {permisos.gestionarStock && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={sincronizar}
              disabled={!odooConectado || sincronizando}
              className="gap-1.5"
            >
              <RefreshCw className={cn("size-4", sincronizando && "animate-spin")} />
              {sincronizando ? "Sincronizando…" : "Sincronizar con Odoo"}
            </Button>
            <Button onClick={() => setRegistrando(true)} className="gap-1.5">
              <Plus className="size-4" />
              Registrar sobrante
            </Button>
          </div>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:min-w-60">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            aria-label="Buscar sobrante"
            placeholder="Material, código, ubicación o medida: cristal 3 60x80"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={almacenId ?? TODOS} onValueChange={(v) => setAlmacenId(v === TODOS || !v ? null : v)}>
          <SelectTrigger aria-label="Almacén" className="w-full sm:w-52">
            <SelectValue>{elegido ? elegido.nombre : "Todos los almacenes"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los almacenes</SelectItem>
            {conSobrantes.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Opciones
          valores={[vista]}
          onToggle={(v) => setVista(v as Vista)}
          opciones={[
            { valor: "disponibles", label: `En almacén (${enAlmacen})` },
            { valor: "todos", label: `Todos (${sobrantes.length})` },
          ]}
        />
      </div>

      <p className="text-muted-foreground mb-2 text-xs" aria-live="polite">
        {lista.length === 0
          ? sobrantes.length === 0
            ? "Todavía no hay sobrantes registrados."
            : "Ningún sobrante coincide."
          : `${lista.length} ${lista.length === 1 ? "sobrante" : "sobrantes"}${medida ? " donde cabe esa medida, del más chico al más grande" : ""}`}
      </p>

      {lista.length > 0 && (
        <ul className="bg-card divide-y rounded-xl border" aria-label="Sobrantes">
          {lista.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-primary font-mono text-sm font-semibold">{s.codigo}</span>
                  <span className="text-sm font-medium">{s.material}</span>
                </p>
                <p className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs">
                  <span className="text-foreground tnum text-sm font-medium">{medidaSobrante(s)} cm</span>
                  {s.estandar && (
                    <span className="bg-muted rounded px-1.5 py-0.5 text-2xs font-medium">Estándar</span>
                  )}
                  <span className="text-foreground flex items-center gap-1 font-medium">
                    <Warehouse className="size-3" />
                    {s.almacen}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3" />
                    {s.ubicacion ?? "Sin ubicación"}
                  </span>
                  {permisos.verPrecios && (
                    <span className="tnum" title={s.precioVenta === null ? "Calculado: costo de su parte de la plancha por el factor" : "Fijado por Administración"}>
                      {precios[s.codigo] === null || precios[s.codigo] === undefined
                        ? "Sin precio"
                        : `${money(precios[s.codigo]!)}${s.precioVenta === null ? " (calculado)" : ""}`}
                    </span>
                  )}
                  <span>Desde el {fechaCompleta(diaEnLima(s.creadoEn))}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <EstadoSobrante sobrante={s} />
                {s.sincronizacion !== "sincronizada" && (s.estado === "disponible" || s.estado === "reservado") && (
                  <span
                    className="text-st-observado flex items-center gap-1 text-xs"
                    title={s.errorSincronizacion ?? undefined}
                  >
                    <CircleAlert className="size-3.5" />
                    {s.origen === "corte" || s.origen === "terminado"
                      ? `Entra a Odoo al terminar ${s.nacioEn ?? "su pedido"}`
                      : s.sincronizacion === "error"
                        ? "No está en Odoo"
                        : "Creándose en Odoo"}
                  </span>
                )}
              </div>

              <div className="ml-auto flex flex-wrap gap-1">
                {permisos.gestionarStock &&
                  s.sincronizacion === "error" &&
                  s.origen !== "corte" &&
                  s.origen !== "terminado" &&
                  (s.estado === "disponible" || s.estado === "reservado") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reintentar(s)}
                    disabled={reintentando}
                    className="gap-1.5"
                  >
                    <RotateCw className="size-3.5" />
                    Reintentar
                  </Button>
                )}
                {permisos.editarPrecios && (s.estado === "disponible" || s.estado === "reservado") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setPreciando(s)}
                    aria-label={`Cambiar el precio de ${s.codigo}`}
                  >
                    <Pencil className="size-3.5" />
                    Precio
                  </Button>
                )}
                {permisos.gestionarStock && (s.estado === "disponible" || s.estado === "reservado") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMoviendo(s)}
                    aria-label={`Cambiar la ubicación de ${s.codigo}`}
                  >
                    Mover
                  </Button>
                )}
                {permisos.gestionarStock && alTransferir && s.estado === "disponible" && s.odooLotId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => alTransferir(s)}
                    aria-label={`Llevar ${s.codigo} a otro almacén`}
                    disabled={!odooConectado}
                  >
                    A otro almacén
                  </Button>
                )}
                {permisos.gestionarStock && alReportarBaja && (s.estado === "disponible" || s.estado === "reservado") && s.odooLotId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => alReportarBaja(s)}
                    aria-label={`Reportar baja de ${s.codigo}`}
                    disabled={!odooConectado}
                  >
                    Baja
                  </Button>
                )}
                {alVerHistoria && s.odooLotId && (
                  <Button variant="ghost" size="sm" onClick={() => alVerHistoria(s)} aria-label={`Historia de ${s.codigo}`} disabled={!odooConectado}>
                    Historia
                  </Button>
                )}
                <Button
                  render={<Link href={`/sobrantes/${encodeURIComponent(s.codigo)}/etiqueta`} />}
                  nativeButton={false}
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  aria-label={`Etiqueta de ${s.codigo}`}
                >
                  <Printer className="size-3.5" />
                  Etiqueta
                </Button>
              </div>

              {s.sincronizacion === "error" && s.errorSincronizacion && (
                <p className="text-muted-foreground w-full text-xs">{s.errorSincronizacion}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <DialogoRegistrarSobrante
        abierto={registrando}
        alCambiar={setRegistrando}
        catalogo={catalogo}
        almacenes={almacenes}
        alRegistrar={(codigo) => {
          setTexto("");
          setVista("disponibles");
          toast.success(`${codigo} registrado`, {
            action: { label: "Imprimir etiqueta", onClick: () => router.push(`/sobrantes/${codigo}/etiqueta`) },
            duration: 10_000,
          });
        }}
      />
      <DialogoUbicacion sobrante={moviendo} alCerrar={() => setMoviendo(null)} />
      {preciando && (
        <DialogoPrecio
          titulo={`Precio de ${preciando.codigo}`}
          descripcion={`${preciando.material} · ${medidaSobrante(preciando)} cm. Vacío: el calculado, que es el costo de su parte de la plancha por el factor de la configuración.`}
          actual={preciando.precioVenta}
          permiteVaciar
          alGuardar={(precio) => acciones.fijarPrecioSobrante({ codigo: preciando.codigo, precio })}
          alCerrar={() => setPreciando(null)}
        />
      )}
    </div>
  );
}

function EstadoSobrante({ sobrante: s }: { sobrante: Sobrante }) {
  const tono =
    s.estado === "disponible"
      ? "bg-st-entregado-soft text-st-entregado ring-st-entregado/25"
      : s.estado === "reservado" || s.estado === "en_transito"
        ? "bg-st-en_transito-soft text-st-en_transito ring-st-en_transito/25"
        : "bg-muted text-muted-foreground ring-border";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tono)}>
      {ESTADOS_SOBRANTE[s.estado]}
      {s.pedido && (
        <>
          {" · "}
          <Link href={`/pedidos/${encodeURIComponent(s.pedido)}`} className="hover:underline">
            {s.pedido}
          </Link>
        </>
      )}
    </span>
  );
}
