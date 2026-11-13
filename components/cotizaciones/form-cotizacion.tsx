"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { Package, Scissors } from "lucide-react";
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
  type LineaTerminado,
} from "@/lib/lineas-cotizacion";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import { EditorCorte } from "@/components/cortes/editor-corte";
import { EditorTerminado } from "@/components/terminados/editor-terminado";
import type { CatalogoTerminados } from "@/lib/terminados/catalogo";
import type { ClienteOdoo, ProductoOdoo } from "@/lib/odoo/tipos";
import { Button } from "@/components/ui/button";
import { BarraEnvio } from "@/components/ui/barra-envio";
import { CabeceraFormulario } from "@/components/ui/cabecera-formulario";
import { Campo, Opciones } from "@/components/ui/campo";
import { Seccion } from "@/components/ui/seccion";
import { useAvisoSalida } from "@/lib/use-aviso-salida";
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
  lineaInicial = null,
}: {
  catalogo: GrupoPlancha[];
  config: ConfigCortes;
  /** El catálogo de productos terminados. */
  terminados: CatalogoTerminados;
  /** Un producto terminado con el que arrancar (p. ej. desde un diseño CAD); se abre en su editor. */
  lineaInicial?: Omit<LineaTerminado, "tipo" | "clave"> | null;
}) {
  const router = useRouter();
  const [canal, setCanal] = useState<Canal>("tienda");
  const [cliente, setCliente] = useState<ClienteOdoo | null>(null);
  const [arranque] = useState(() => (lineaInicial ? ponerTerminado([], lineaInicial) : null));
  const [lineas, setLineas] = useState<Linea[]>(arranque?.lineas ?? []);
  /** El editor de corte: cerrado, abierto para uno nuevo, o editando el de esa clave. */
  const [corte, setCorte] = useState<{ clave: string | null } | null>(null);
  /** Lo mismo, para el editor de producto terminado. */
  const [terminado, setTerminado] = useState<{ clave: string | null } | null>(
    arranque ? { clave: arranque.clave } : null,
  );
  const [notas, setNotas] = useState("");
  const [resaltada, setResaltada] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  /** Ya se intentó crear: desde ahí, lo que falta se dice junto a su sección. */
  const [intentado, setIntentado] = useState(false);
  /** Creada: ya no hay nada que perder al salir. */
  const [creada, setCreada] = useState(false);

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
  const problemaLineas = problemaDeLineas(lineas);
  const problema = !cliente ? "Elige el cliente." : problemaLineas;

  useAvisoSalida(!creada && (!!cliente || lineas.length > 0 || notas.trim() !== ""));

  const crear = () => {
    if (pendiente) return;
    setIntentado(true);
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
      setCreada(true);
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
      <CabeceraFormulario
        volverA="/cotizaciones"
        volverTexto="Cotizaciones"
        titulo="Nueva cotización"
        subtitulo="Se crea también en Odoo."
        lateral={
          <p className="hidden text-xs text-white/70 md:block">
            Crear sin soltar el teclado:{" "}
            <kbd className="rounded border border-white/25 bg-white/10 px-1 py-px font-mono text-2xs text-white">Ctrl</kbd>{" "}
            +{" "}
            <kbd className="rounded border border-white/25 bg-white/10 px-1 py-px font-mono text-2xs text-white">Enter</kbd>
          </p>
        }
      />

      <div className="relative -mt-10 flex max-w-3xl flex-col gap-4">
        <Seccion n={1} titulo="Cliente" completa={!!cliente}>
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
          {intentado && !cliente && (
            <p role="alert" className="text-destructive text-sm">
              Elige el cliente.
            </p>
          )}
        </Seccion>

        <Seccion
          n={2}
          titulo="Productos"
          completa={lineas.length > 0 && !problemaLineas}
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
          {intentado && problemaLineas && (
            <p role="alert" className="text-destructive text-sm">
              {problemaLineas}
            </p>
          )}
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

      <BarraEnvio
        resumen={[
          { etiqueta: lineas.length === 1 ? "Producto" : "Productos", valor: String(lineas.length) },
          { etiqueta: "Total", valor: money(total) },
        ]}
        problema={problema}
        texto="Crear cotización"
        textoPendiente="Creando en Odoo…"
        pendiente={pendiente}
        onClick={crear}
      />
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
      disenoVersionId: l.disenoVersionId ?? null,
    };
  }
  return {
    productoId: l.productoId,
    cantidad: Number(l.cantidad),
    precioUnitario: Number(l.precioUnitario),
    descripcion: l.descripcion.trim() || null,
  };
}
