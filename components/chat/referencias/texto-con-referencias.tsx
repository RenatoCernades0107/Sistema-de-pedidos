"use client";

/**
 * El texto de un mensaje con sus fichas @ pintadas.
 *
 * Cada ficha lleva el icono de su tipo y su etiqueta, y al tocarla:
 *   - pedido → abre el pedido; diseño → abre el diseño (en la versión del ítem
 *     si salió de un pedido);
 *   - cliente → una tarjeta con su documento, su teléfono (si el rol lo ve) y
 *     sus pedidos recientes, leída en ese momento;
 *   - plancha → material, color, espesor, formatos con su código y sobrantes;
 *   - usuario → nombre, rol y "Enviar mensaje directo".
 *
 * La ficha pinta la foto guardada en el mensaje; las tarjetas leen lo de ahora.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import {
  enlaceDeReferencia,
  type FichaCliente,
  type FichaPlancha,
  type FichaReferencia,
} from "@/lib/chat/referencias";
import type { Referencia } from "@/lib/chat/tipos";
import { partirReferencias } from "@/lib/chat/tipos";
import { ROLES, type Rol } from "@/lib/dominio";
import { clienteNavegador } from "@/lib/supabase-cliente";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FICHA_PROPIA, FICHA_TEXTO, ICONO_REFERENCIA } from "./estilos";

export interface PropsTextoConReferencias {
  texto: string;
  referencias: Referencia[];
  /** El mensaje es de quien mira: la burbuja tiene fondo de color primario. */
  propio?: boolean;
}

export function TextoConReferencias({ texto, referencias, propio = false }: PropsTextoConReferencias) {
  return (
    <>
      {partirReferencias(texto, referencias).map((t, i) =>
        typeof t === "string" ? <span key={i}>{t}</span> : <FichaReferencia key={i} referencia={t} propio={propio} />,
      )}
    </>
  );
}

const CLASE_FICHA =
  "inline-flex max-w-full items-baseline gap-1 rounded px-1 align-baseline font-medium break-words transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

function ContenidoFicha({ referencia }: { referencia: Referencia }) {
  const Icono = ICONO_REFERENCIA[referencia.tipo];
  return (
    <>
      <Icono className="size-3.5 shrink-0 translate-y-0.5 self-start" aria-hidden />
      <span className="min-w-0">{referencia.etiqueta}</span>
    </>
  );
}

/** Una ficha del mensaje. Los enlaces van directo; lo demás abre una tarjeta. */
export function FichaReferencia({ referencia, propio = false }: { referencia: Referencia; propio?: boolean }) {
  const clase = cn(CLASE_FICHA, propio ? FICHA_PROPIA : FICHA_TEXTO[referencia.tipo]);
  const enlace = enlaceDeReferencia(referencia);
  const titulo = referencia.detalle ? `${referencia.etiqueta} · ${referencia.detalle}` : referencia.etiqueta;

  if (enlace) {
    return (
      <Link href={enlace} className={clase} title={titulo}>
        <ContenidoFicha referencia={referencia} />
      </Link>
    );
  }

  return (
    <Popover>
      <PopoverTrigger className={cn(clase, "cursor-pointer text-left")} title={titulo}>
        <ContenidoFicha referencia={referencia} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2">
        {referencia.tipo === "usuario" ? <TarjetaUsuario referencia={referencia} /> : <TarjetaLeida referencia={referencia} />}
      </PopoverContent>
    </Popover>
  );
}

function Encabezado({ referencia, children }: { referencia: Referencia; children?: ReactNode }) {
  const Icono = ICONO_REFERENCIA[referencia.tipo];
  return (
    <div className="flex items-start gap-2">
      <Icono className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium break-words">{referencia.etiqueta}</p>
        {children}
      </div>
    </div>
  );
}

// ── Usuario ─────────────────────────────────────────────────────────────────

const esRol = (v: unknown): v is Rol => typeof v === "string" && v in ROLES;

function TarjetaUsuario({ referencia }: { referencia: Referencia }) {
  const router = useRouter();
  const [abriendo, setAbriendo] = useState(false);
  const rol = referencia.datos?.rol;

  const escribir = async () => {
    setAbriendo(true);
    const { data, error } = await clienteNavegador().rpc("abrir_directo", { p_usuario_id: referencia.id });
    setAbriendo(false);
    if (error || !data) {
      toast.error(error?.message ?? "No se pudo abrir la conversación.");
      return;
    }
    router.push(`/chat/${data}`);
  };

  return (
    <>
      <Encabezado referencia={referencia}>
        <p className="text-xs text-muted-foreground">{esRol(rol) ? ROLES[rol].nombre : referencia.detalle}</p>
      </Encabezado>
      <Button size="sm" variant="outline" onClick={escribir} disabled={abriendo} className="w-full">
        {abriendo ? <Loader2 className="animate-spin" /> : <MessageCircle />}
        Enviar mensaje directo
      </Button>
    </>
  );
}

// ── Cliente y plancha: se leen al abrir ─────────────────────────────────────

const fechaCorta = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", timeZone: "America/Lima" });

function TarjetaLeida({ referencia }: { referencia: Referencia }) {
  const [estado, setEstado] = useState<{ ficha: FichaReferencia | null; error: string | null; cargando: boolean }>({
    ficha: null,
    error: null,
    cargando: true,
  });

  // Se lee al abrir la tarjeta (el popover la monta), con la sesión y el rol de quien mira.
  useEffect(() => {
    const ctrl = new AbortController();
    const p = new URLSearchParams({ tipo: referencia.tipo, id: referencia.id, etiqueta: referencia.etiqueta });
    fetch(`/api/chat/referencias/ficha?${p}`, { signal: ctrl.signal })
      .then(async (res) => {
        const json = (await res.json()) as FichaReferencia & { error?: string };
        setEstado(
          res.ok
            ? { ficha: json, error: null, cargando: false }
            : { ficha: null, error: json.error ?? "No se pudo cargar.", cargando: false },
        );
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setEstado({ ficha: null, error: "No se pudo cargar. Revisa la conexión.", cargando: false });
      });
    return () => ctrl.abort();
  }, [referencia.tipo, referencia.id, referencia.etiqueta]);

  const { ficha, error, cargando } = estado;
  return (
    <>
      <Encabezado referencia={referencia}>
        {referencia.detalle && <p className="text-xs text-muted-foreground">{referencia.detalle}</p>}
      </Encabezado>
      {cargando && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Cargando…
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {ficha?.tipo === "cliente" && <DatosCliente ficha={ficha} />}
      {ficha?.tipo === "plancha" && <DatosPlancha ficha={ficha} />}
    </>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

function DatosCliente({ ficha }: { ficha: FichaCliente }) {
  return (
    <>
      <dl className="flex flex-col gap-1">
        {ficha.documento && <Dato etiqueta="Documento">{ficha.documento}</Dato>}
        {ficha.telefono && (
          <Dato etiqueta="Teléfono">
            <a href={`tel:${ficha.telefono.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">
              {ficha.telefono}
            </a>
          </Dato>
        )}
        {ficha.ciudad && <Dato etiqueta="Ciudad">{ficha.ciudad}</Dato>}
      </dl>
      <div className="flex flex-col gap-1 border-t pt-2">
        <p className="text-xs font-medium">Pedidos recientes</p>
        {ficha.pedidos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin pedidos registrados.</p>
        ) : (
          <ul className="flex flex-col">
            {ficha.pedidos.map((p) => (
              <li key={p.codigo}>
                <Link
                  href={`/pedidos/${encodeURIComponent(p.codigo)}`}
                  className="-mx-1 flex items-center justify-between gap-2 rounded px-1 py-1 text-xs hover:bg-muted"
                >
                  <span className="font-medium">{p.codigo}</span>
                  <span className="text-muted-foreground">
                    {p.estado} · {fechaCorta.format(new Date(p.fechaCreacion))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function DatosPlancha({ ficha }: { ficha: FichaPlancha }) {
  return (
    <>
      <dl className="flex flex-col gap-1">
        <Dato etiqueta="Material">{ficha.material}</Dato>
        <Dato etiqueta="Color">{ficha.color}</Dato>
        <Dato etiqueta="Espesor">{ficha.espesor}</Dato>
        <Dato etiqueta="Sobrantes">{ficha.sobrantes > 0 ? `${ficha.sobrantes} disponibles` : "Ninguno"}</Dato>
      </dl>
      {ficha.formatos.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2">
          <p className="text-xs font-medium">Formatos</p>
          <ul className="flex flex-col gap-0.5">
            {ficha.formatos.map((f) => (
              <li
                key={f.id}
                className={cn(
                  "flex justify-between gap-2 rounded px-1 text-xs",
                  f.id === ficha.formatoId && "bg-muted font-medium",
                )}
              >
                <span>{f.medida}</span>
                <span className="font-mono text-muted-foreground">{f.codigo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
