"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, MapPin, Plus, Printer, RefreshCw, RotateCw, Search } from "lucide-react";
import * as acciones from "@/app/(app)/sobrantes/acciones";
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
import { DialogoRegistrarSobrante, DialogoUbicacion } from "./dialogos-sobrante";

type Vista = "disponibles" | "todos";

/** Lo que la búsqueda entiende: palabras (material, código, ubicación) y una medida "60x80". */
function filtrar(sobrantes: Sobrante[], texto: string, vista: Vista): { lista: Sobrante[]; medida: boolean } {
  const pieza = leerMedidaBuscada(texto);
  const palabras = texto
    .replace(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i, " ")
    .split(/\s+/)
    .map(compactar)
    .filter(Boolean);

  const lista = sobrantes.filter((s) => {
    if (vista === "disponibles" && s.estado !== "disponible" && s.estado !== "reservado") return false;
    if (pieza && !cabeEn(s, pieza)) return false;
    const donde = compactar(`${s.codigo} ${s.material} ${s.ubicacion ?? ""}`);
    return palabras.every((p) => donde.includes(p));
  });
  // Con una medida, primero el que conviene usar: el más chico donde cabe.
  return { lista: pieza ? ordenDeUso(lista) : lista, medida: !!pieza };
}

/**
 * Los sobrantes del almacén: buscar uno para una pieza, registrar los que se
 * miden, imprimir su etiqueta y mantener la lista de acuerdo con Odoo.
 */
export function PantallaSobrantes({
  sobrantes,
  catalogo,
  odooConectado,
}: {
  sobrantes: Sobrante[];
  catalogo: GrupoPlancha[];
  odooConectado: boolean;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [vista, setVista] = useState<Vista>("disponibles");
  const [registrando, setRegistrando] = useState(false);
  const [moviendo, setMoviendo] = useState<Sobrante | null>(null);
  const [sincronizando, iniciarSincronizacion] = useTransition();
  const [reintentando, iniciarReintento] = useTransition();

  const { lista, medida } = useMemo(() => filtrar(sobrantes, texto, vista), [sobrantes, texto, vista]);
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
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Sobrantes</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Los pedazos de plancha que quedan en el almacén. Busca por material o por la medida que necesitas
            (<span className="font-mono">60x80</span>) y aparecen primero los que conviene usar.
          </p>
        </div>
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
      </header>

      {!odooConectado && (
        <p className="border-st-observado/25 bg-st-observado-soft mb-4 flex gap-2 rounded-xl border p-3 text-sm">
          <CircleAlert className="text-st-observado mt-0.5 size-4 shrink-0" />
          Falta conectar Odoo: los sobrantes se registran aquí, pero su lote en Odoo se crea cuando esté conectado.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            aria-label="Buscar sobrante"
            placeholder="Material, código, ubicación o medida: cristal 3 60x80"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="pl-9"
          />
        </div>
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
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3" />
                    {s.ubicacion ?? "Sin ubicación"}
                  </span>
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
                    {s.origen === "corte"
                      ? `Entra a Odoo al cerrar la producción de ${s.nacioEn ?? "su pedido"}`
                      : s.sincronizacion === "error"
                        ? "No está en Odoo"
                        : "Creándose en Odoo"}
                  </span>
                )}
              </div>

              <div className="ml-auto flex flex-wrap gap-1">
                {s.sincronizacion === "error" && s.origen !== "corte" && (s.estado === "disponible" || s.estado === "reservado") && (
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
                {(s.estado === "disponible" || s.estado === "reservado") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMoviendo(s)}
                    aria-label={`Cambiar la ubicación de ${s.codigo}`}
                  >
                    Mover
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
    </div>
  );
}

function EstadoSobrante({ sobrante: s }: { sobrante: Sobrante }) {
  const tono =
    s.estado === "disponible"
      ? "bg-st-entregado-soft text-st-entregado ring-st-entregado/25"
      : s.estado === "reservado"
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
