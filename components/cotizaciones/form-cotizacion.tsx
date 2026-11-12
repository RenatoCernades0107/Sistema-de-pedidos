"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Package, Scissors } from "lucide-react";
import { toast } from "sonner";
import { crearCotizacion } from "@/app/(app)/cotizaciones/acciones";
import { CANALES, type Canal } from "@/lib/cotizaciones";
import { money } from "@/lib/formato";
import {
  actualizarLinea,
  agregarProducto,
  cambiarCantidad,
  esCorte,
  esTerminado,
  ponerCorte,
  ponerTerminado,
  problemaDeLineas,
  quitarLinea,
  totalReferencial,
  type Linea,
} from "@/lib/lineas-cotizacion";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import { EditorCorte } from "@/components/cortes/editor-corte";
import { EditorTerminado } from "@/components/terminados/editor-terminado";
import type { CatalogoTerminados } from "@/lib/terminados/catalogo";
import type { ClienteOdoo, ProductoOdoo } from "@/lib/odoo/tipos";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
import { Textarea } from "@/components/ui/textarea";
import { BuscadorCliente } from "./buscador-cliente";
import { BuscadorProducto } from "./buscador-producto";
import { LineasCotizacion } from "./lineas-cotizacion";

/**
 * Registrar una cotización. Pensado para el mostrador: teclado primero y que
 * nada obligue a soltarlo.
 *
 *   cliente → Enter → código del producto → Enter → cantidad → Enter →
 *   siguiente producto → … → Ctrl/⌘ + Enter
 *
 * Al crear, se guarda en la base y se crea en Odoo en el mismo paso. Si Odoo
 * falla, lo cotizado queda guardado y el detalle ofrece reintentar.
 */
export function FormCotizacion({
  catalogo,
  config,
  terminados,
}: {
  catalogo: GrupoPlancha[];
  config: ConfigCortes;
  /** El catálogo de productos terminados. */
  terminados: CatalogoTerminados;
}) {
  const router = useRouter();
  const [canal, setCanal] = useState<Canal>("tienda");
  const [cliente, setCliente] = useState<ClienteOdoo | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  /** El editor de corte: cerrado, abierto para uno nuevo, o editando el de esa clave. */
  const [corte, setCorte] = useState<{ clave: string | null } | null>(null);
  /** Lo mismo, para el editor de producto terminado. */
  const [terminado, setTerminado] = useState<{ clave: string | null } | null>(null);
  const [notas, setNotas] = useState("");
  const [resaltada, setResaltada] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const buscadorProducto = useRef<HTMLInputElement>(null);
  const buscadorCliente = useRef<HTMLInputElement>(null);
  const cantidades = useRef(new Map<string, HTMLInputElement>());
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);

  const marcar = (clave: string) => {
    setResaltada(clave);
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setResaltada(null), 1200);
  };

  const elegirCliente = (c: ClienteOdoo | null) => {
    flushSync(() => setCliente(c));
    // Con el cliente elegido, lo siguiente son los productos.
    if (c) buscadorProducto.current?.focus();
  };

  const agregar = (p: ProductoOdoo) => {
    // Fuera del actualizador a propósito: genera la clave de la línea, y un
    // actualizador tiene que ser puro (el modo estricto lo corre dos veces).
    // Si ya estaba, suma uno a su línea: el resaltado y el foco en su cantidad
    // lo dicen sin un aviso que tape la barra de crear.
    const { lineas: siguientes, clave } = agregarProducto(lineas, p);
    flushSync(() => setLineas(siguientes));
    marcar(clave);
    // A la cantidad de esa línea, con el número seleccionado: se escribe encima.
    const input = cantidades.current.get(clave);
    input?.focus();
    input?.select();
  };

  const refCantidad = useCallback((clave: string, el: HTMLInputElement | null) => {
    if (el) cantidades.current.set(clave, el);
    else cantidades.current.delete(clave);
  }, []);

  const total = totalReferencial(lineas);
  const problema = !cliente ? "Elige el cliente." : problemaDeLineas(lineas);

  const crear = () => {
    if (pendiente) return;
    if (problema || !cliente) {
      toast.error(problema ?? "Falta el cliente.");
      if (!cliente) buscadorCliente.current?.focus();
      else if (lineas.length === 0) buscadorProducto.current?.focus();
      return;
    }

    iniciar(async () => {
      const r = await crearCotizacion({
        canal,
        clienteId: cliente.id,
        lineas: lineas.map(lineaParaEnviar),
        notas: notas.trim() || null,
      });

      if (!r.ok) {
        toast.error("No se pudo crear la cotización", { description: r.error });
        return;
      }
      if (r.enOdoo) {
        toast.success(`Cotización ${r.orderName} creada en Odoo`);
      } else {
        toast.warning("Se guardó, pero Odoo no la aceptó", {
          description: r.errorOdoo ?? undefined,
        });
      }
      router.push(`/cotizaciones/${r.id}`);
    });
  };

  return (
    <div
      className="px-4 py-5 md:px-6 md:py-6"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          crear();
        }
      }}
    >
      <Button
        render={<Link href="/cotizaciones" />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="text-muted-foreground -ml-2 mb-3 gap-1.5"
      >
        <ArrowLeft className="size-3.5" />
        Cotizaciones
      </Button>

      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Nueva cotización</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Se crea también en Odoo.
          <span className="hidden md:inline">
            {" "}
            Para crearla sin soltar el teclado: <kbd className="kbd">Ctrl</kbd> +{" "}
            <kbd className="kbd">Enter</kbd>.
          </span>
        </p>
      </header>

      <div className="flex max-w-3xl flex-col gap-4">
        <Seccion n={1} titulo="Cliente">
          <Campo grupo label="Canal" ayuda="De dónde llegó el pedido de cotización.">
            <Opciones
              valores={[canal]}
              onToggle={(v) => setCanal(v as Canal)}
              opciones={Object.entries(CANALES).map(([valor, label]) => ({ valor, label }))}
            />
          </Campo>
          <BuscadorCliente
            cliente={cliente}
            alElegir={elegirCliente}
            inputRef={buscadorCliente}
            autoFocus
          />
        </Seccion>

        <Seccion
          n={2}
          titulo="Productos"
          nota={lineas.length ? `${lineas.length} ${lineas.length === 1 ? "línea" : "líneas"}` : undefined}
        >
          {/* En una sola fila siempre: si el botón bajara de línea, la lista de
              resultados del buscador lo taparía. */}
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <BuscadorProducto alAgregar={agregar} inputRef={buscadorProducto} />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0 gap-1.5"
              aria-label="Corte a medida"
              onClick={() => setCorte({ clave: null })}
              disabled={catalogo.length === 0}
              title={catalogo.length === 0 ? "No hay planchas en el catálogo" : undefined}
            >
              <Scissors />
              Corte<span className="hidden sm:inline"> a medida</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0 gap-1.5"
              aria-label="Producto terminado"
              onClick={() => setTerminado({ clave: null })}
            >
              <Package />
              <span className="hidden sm:inline">Producto </span>terminado
            </Button>
          </div>
          <LineasCotizacion
            lineas={lineas}
            resaltada={resaltada}
            refCantidad={refCantidad}
            alCambiar={(clave, cambios) => setLineas((ls) => actualizarLinea(ls, clave, cambios))}
            alCambiarCantidad={(clave, delta) => setLineas((ls) => cambiarCantidad(ls, clave, delta))}
            alQuitar={(clave) => {
              setLineas((ls) => quitarLinea(ls, clave));
              buscadorProducto.current?.focus();
            }}
            alEditarCorte={(clave) => setCorte({ clave })}
            alEditarTerminado={(clave) => setTerminado({ clave })}
            alTerminar={() => buscadorProducto.current?.focus()}
          />
        </Seccion>

        <Seccion n={3} titulo="Notas" nota="Opcional">
          <Campo label="Notas internas" ayuda="Quedan en el sistema; no salen en la cotización de Odoo.">
            <Textarea
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              maxLength={2000}
              placeholder="Ej. pasa a recoger el viernes; quiere el corte en láser"
            />
          </Campo>
        </Seccion>
      </div>

      {corte && (
        <EditorCorte
          catalogo={catalogo}
          config={config}
          inicial={lineas.filter(esCorte).find((l) => l.clave === corte.clave) ?? null}
          alCerrar={() => setCorte(null)}
          alGuardar={(nuevo) => {
            const { lineas: siguientes, clave } = ponerCorte(lineas, nuevo);
            setLineas(siguientes);
            setCorte(null);
            marcar(clave);
            // De vuelta al buscador: lo siguiente es otro producto o crear.
            requestAnimationFrame(() => buscadorProducto.current?.focus());
          }}
        />
      )}

      {terminado && (
        <EditorTerminado
          catalogo={terminados}
          planchas={catalogo}
          configCortes={config}
          inicial={lineas.filter(esTerminado).find((l) => l.clave === terminado.clave) ?? null}
          alCerrar={() => setTerminado(null)}
          alGuardar={(nuevo) => {
            const { lineas: siguientes, clave } = ponerTerminado(lineas, nuevo);
            setLineas(siguientes);
            setTerminado(null);
            marcar(clave);
            requestAnimationFrame(() => buscadorProducto.current?.focus());
          }}
        />
      )}

      {/* La barra de crear acompaña al scroll. En el celular va encima de las pestañas. */}
      <div className="bg-background/90 sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-4 border-t px-4 py-3 backdrop-blur-md md:bottom-0 md:-mx-6 md:px-6">
        <div className="flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs">
              {lineas.length} {lineas.length === 1 ? "producto" : "productos"} · total referencial
            </p>
            <p className="tnum text-lg leading-tight font-semibold" aria-live="polite">
              {money(total)}
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            onClick={crear}
            disabled={pendiente}
            aria-disabled={!!problema}
            title={problema ?? undefined}
            className={problema ? "opacity-60" : undefined}
          >
            {pendiente ? (
              <>
                <Loader2 className="animate-spin" />
                Creando en Odoo…
              </>
            ) : (
              "Crear cotización"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Una línea como viaja a `crearCotizacion`. De un corte van el material, las
 * piezas y el formato; el precio lo vuelve a calcular el servidor, y el total
 * que se mostró va solo para que avise si ya no coincide.
 */
export function lineaParaEnviar(l: Linea) {
  if (esCorte(l)) {
    return {
      tipo: "corte" as const,
      grupoId: l.grupoId,
      color: l.color.trim() || null,
      modalidad: l.modalidad,
      piezas: l.piezas,
      formatoCodigo: l.calculo.formato.codigo,
      totalMostrado: l.calculo.total,
    };
  }
  if (esTerminado(l)) {
    const m = l.medidas;
    return {
      tipo: "terminado" as const,
      productoCodigo: l.productoCodigo,
      nombre: l.productoCodigo ? null : l.nombre.trim() || null,
      tipoCodigo: l.tipoCodigo,
      medidas: {
        m1: m.m1 || null,
        m2: m.m2 || null,
        m3: m.m3 || null,
        diametro: m.diametro || null,
        altura: m.altura || null,
        letras: m.letras || null,
      },
      grupoId: l.grupoId,
      color: l.color?.trim() || null,
      opciones: l.opciones,
      texto: l.texto.trim() || null,
      notas: l.notas.trim() || null,
      areaM2: l.areaManualM2,
      accesorios: l.accesorios.map((a) => ({ productoId: a.productoId, cantidad: Number(a.cantidad) })),
      cantidad: Number(l.cantidad),
      precioUnitario: Number(l.precioUnitario),
      reservar: l.reservar,
    };
  }
  return {
    productoId: l.productoId,
    cantidad: Number(l.cantidad),
    precioUnitario: Number(l.precioUnitario),
    descripcion: l.descripcion.trim() || null,
  };
}

function Seccion({
  n,
  titulo,
  nota,
  children,
}: {
  n: number;
  titulo: string;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border">
      <header className="bg-muted/40 flex items-center gap-2.5 border-b px-4 py-3">
        <span className="bg-primary text-primary-foreground text-2xs grid size-5 shrink-0 place-items-center rounded-full font-semibold">
          {n}
        </span>
        <h2 className="text-sm font-medium">{titulo}</h2>
        {nota && <span className="text-muted-foreground ml-auto text-xs">{nota}</span>}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  );
}
