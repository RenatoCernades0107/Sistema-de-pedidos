"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, TriangleAlert } from "lucide-react";
import * as acciones from "@/app/(app)/compras/acciones";
import type { Almacen } from "@/lib/almacenes";
import { compactar } from "@/lib/busqueda-inteligente";
import {
  CONDICIONES_PAGO,
  TIPOS_COMPRA,
  condicionesDe,
  descuadre,
  type CompraDetalle,
  type CondicionPago,
} from "@/lib/compras";
import type { Incoterm, Moneda, TipoCompra } from "@/lib/costeo";
import { montoEn } from "@/lib/formato";
import { compraTieneContenido, resumenDeCompra } from "@/lib/borradores-compra";
import type { BorradorAbierto, DatosBorradorCompra } from "@/lib/borradores";
import { useBorrador } from "@/lib/use-borrador";
import { IndicadorBorrador } from "@/components/borradores/lista-borradores";
import type { ClienteOdoo } from "@/lib/odoo/tipos";
import { ComboBusqueda, type Opcion } from "@/components/cotizaciones/combo-busqueda";
import type { Ingresable } from "@/lib/inventario";
import { SelectorAlmacen } from "@/components/almacen/comun";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import { Seccion } from "@/components/ui/seccion";
import { Textarea } from "@/components/ui/textarea";
import { BuscadorProveedor } from "./buscador-proveedor";

interface Fila {
  productoId: number;
  codigo: string;
  titulo: string;
  cantidad: string;
  kilos: string;
  precio: string;
  total: string;
}

/** Lo escrito como número (acepta coma decimal), o `null`. Vacío es `null`. */
export function leerNumero(t: string): number | null {
  const limpio = t.trim().replace(/\s/g, "").replace(",", ".");
  if (!limpio) return null;
  const v = Number(limpio);
  return Number.isFinite(v) ? v : null;
}

const texto = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

/**
 * La pre-compra: el proveedor, a qué almacén llega, en qué moneda y condiciones,
 * y los ítems tal como vienen en la proforma o el PDF del proveedor (cantidad,
 * kilos, precio unitario y total). Se guarda como borrador y se puede corregir
 * mientras se negocia; al confirmarla se vuelve orden de compra en Odoo.
 */
export function EditorCompra({
  compra,
  almacenes,
  productos,
  tcSugerido,
  odooListo,
  borrador = null,
}: {
  compra: CompraDetalle | null;
  almacenes: Almacen[];
  productos: Ingresable[];
  tcSugerido: number | null;
  odooListo: boolean;
  /** El borrador del formulario que se retoma (solo en una compra nueva). */
  borrador?: BorradorAbierto<DatosBorradorCompra> | null;
}) {
  const router = useRouter();
  const previo = compra ? null : (borrador?.datos ?? null);
  const [tipo, setTipo] = useState<TipoCompra>(compra?.tipo ?? previo?.tipo ?? "nacional");
  const [proveedor, setProveedor] = useState<ClienteOdoo | null>(
    compra ? ({ id: compra.proveedorId, nombre: compra.proveedor, documento: null } as ClienteOdoo) : (previo?.proveedor ?? null),
  );
  const [almacenId, setAlmacenId] = useState<string | null>(compra?.almacenId ?? previo?.almacenId ?? null);
  const [documento, setDocumento] = useState(compra?.documentoProveedor ?? previo?.documento ?? "");
  const [moneda, setMoneda] = useState<Moneda>(compra?.monedaMercaderia ?? previo?.moneda ?? "PEN");
  const [tcMerc, setTcMerc] = useState(previo?.tcMerc ?? texto(compra?.tcMercaderia ?? tcSugerido));
  const [tcGastos, setTcGastos] = useState(previo?.tcGastos ?? texto(compra?.tcGastos ?? tcSugerido));
  const [incoterm, setIncoterm] = useState<Incoterm | null>(compra?.incoterm ?? previo?.incoterm ?? null);
  const [condicion, setCondicion] = useState<CondicionPago>(compra?.condicionPago ?? previo?.condicion ?? "contado");
  const [dias, setDias] = useState(compra ? texto(compra.diasCredito) : (previo?.dias ?? ""));
  const [embarque, setEmbarque] = useState(compra?.fechaEmbarque ?? previo?.embarque ?? "");
  const [llegada, setLlegada] = useState(compra?.fechaLlegadaEstimada ?? previo?.llegada ?? "");
  const [nota, setNota] = useState(compra?.nota ?? previo?.nota ?? "");
  const [filas, setFilas] = useState<Fila[]>(
    previo ? previo.filas : (compra?.lineas ?? []).map((l) => ({
      productoId: l.productoId,
      codigo: l.codigo ?? "",
      titulo: productos.find((p) => p.productoId === l.productoId)?.titulo ?? l.nombre,
      cantidad: String(l.cantidad),
      kilos: texto(l.kilos),
      precio: String(l.precioUnitario),
      total: texto(l.totalProveedor),
    })),
  );
  const [guardada, setGuardada] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const cambiarTipo = (t: TipoCompra) => {
    setTipo(t);
    if (t === "importacion") {
      setMoneda("USD");
      setIncoterm((i) => i ?? "FOB");
      if (!condicionesDe(t).includes(condicion)) setCondicion("adelantado");
    } else {
      setIncoterm(null);
      if (!condicionesDe(t).includes(condicion)) setCondicion("contado");
    }
    setError(null);
  };

  const opciones: Opcion[] = useMemo(() => {
    const palabras = consulta.split(/\s+/).map(compactar).filter(Boolean);
    if (palabras.length === 0) return [];
    return productos
      .filter((p) => !filas.some((f) => f.productoId === p.productoId))
      .filter((p) => palabras.every((x) => compactar(`${p.codigo} ${p.titulo}`).includes(x)))
      .slice(0, 12)
      .map((p) => ({
        valor: String(p.productoId),
        alElegir: () => {
          setFilas((fs) => [...fs, { productoId: p.productoId, codigo: p.codigo, titulo: p.titulo, cantidad: "", kilos: "", precio: "", total: "" }]);
          setConsulta("");
          setError(null);
        },
        contenido: (
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="text-muted-foreground font-mono text-xs">{p.codigo}</span>
            <span className="min-w-0 truncate">{p.titulo}</span>
          </span>
        ),
      }));
  }, [productos, consulta, filas]);

  const cambiar = (i: number, cambios: Partial<Fila>) => {
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambios } : f)));
    setError(null);
  };

  // Una compra nueva a medio llenar se guarda como borrador del formulario (no es
  // la pre-compra: esa exige todo válido). Editar una ya guardada no lo usa.
  const datosBorrador: DatosBorradorCompra = {
    version: 1,
    tipo,
    proveedor,
    almacenId,
    documento,
    moneda,
    tcMerc,
    tcGastos,
    incoterm,
    condicion,
    dias,
    embarque,
    llegada,
    nota,
    filas,
  };
  const hayContenido = compraTieneContenido(datosBorrador);
  const autoguardado = useBorrador({
    tipo: "compra",
    idInicial: borrador?.id ?? null,
    datos: datosBorrador,
    resumen: resumenDeCompra(datosBorrador),
    conContenido: hayContenido,
    activo: !compra && !guardada,
  });

  const guardarBorrador = async () => {
    const ok = await autoguardado.guardarAhora();
    if (ok) toast.success("Borrador guardado", { description: "Lo retomas desde Compras. Se borra solo a las 48 h sin abrirlo." });
    else toast.error("No se pudo guardar el borrador");
  };

  const total = filas.reduce((t, f) => t + (leerNumero(f.cantidad) ?? 0) * (leerNumero(f.precio) ?? 0), 0);
  const kilos = filas.reduce((t, f) => t + (leerNumero(f.kilos) ?? 0), 0);

  const armar = () => {
    if (!proveedor) return setError("Elige el proveedor."), null;
    if (!almacenId) return setError("Elige el almacén al que llega."), null;
    if (filas.length === 0) return setError("Agrega al menos un ítem."), null;
    const lineas: { productoId: number; cantidad: number; kilos: number | null; precioUnitario: number; totalProveedor: number | null }[] = [];
    for (const f of filas) {
      const cantidad = leerNumero(f.cantidad);
      if (cantidad === null || !Number.isInteger(cantidad) || cantidad < 1) return setError(`Escribe cuántas planchas de ${f.codigo} (entero).`), null;
      const precio = leerNumero(f.precio);
      if (precio === null || precio < 0) return setError(`Escribe el precio unitario de ${f.codigo}.`), null;
      const k = leerNumero(f.kilos);
      if (f.kilos.trim() && (k === null || k <= 0)) return setError(`Los kilos de ${f.codigo} no son válidos.`), null;
      const t = leerNumero(f.total);
      if (f.total.trim() && (t === null || t < 0)) return setError(`El total de ${f.codigo} no es válido.`), null;
      lineas.push({ productoId: f.productoId, cantidad, kilos: k, precioUnitario: precio, totalProveedor: t });
    }
    const tcM = leerNumero(tcMerc);
    const tcG = leerNumero(tcGastos);
    if (moneda === "USD" && !(tcM && tcM > 0)) return setError("Escribe el tipo de cambio de la mercadería."), null;
    const d = leerNumero(dias);
    if (condicion === "credito" && !(d && Number.isInteger(d) && d > 0)) return setError("Escribe los días de crédito."), null;
    return {
      id: compra?.id ?? null,
      tipo,
      proveedorId: proveedor.id,
      proveedorNombre: proveedor.nombre,
      almacenId,
      documentoProveedor: documento,
      monedaMercaderia: moneda,
      tcMercaderia: moneda === "USD" ? tcM : null,
      tcGastos: tcG && tcG > 0 ? tcG : null,
      incoterm: tipo === "importacion" ? incoterm : null,
      condicionPago: condicion,
      diasCredito: condicion === "credito" ? d : null,
      fechaEmbarque: embarque || null,
      fechaLlegadaEstimada: llegada || null,
      nota,
      lineas,
    };
  };

  const guardar = (confirmar: boolean) => {
    const datos = armar();
    if (!datos) return;
    iniciar(async () => {
      const r = await acciones.guardarCompra(datos);
      if (!r.ok) return setError(r.error);
      if (!compra) {
        // Ya es una pre-compra: el borrador sobra.
        setGuardada(true);
        await autoguardado.terminar();
      }
      if (!confirmar) {
        toast.success(`${r.codigo} guardada`, { description: "Sigue como pre-compra: la puedes corregir mientras negocias." });
        if (!compra) router.push(`/compras/${r.codigo}`);
        return;
      }
      const c = await acciones.confirmarCompra(compra!.id);
      if (!c.ok) return setError(c.error);
      if (c.aviso) toast.warning(`${r.codigo} confirmada`, { description: c.aviso, duration: 12_000 });
      else toast.success(`${r.codigo} confirmada`, { description: "La orden de compra ya está en Odoo. Almacén la recibe cuando llegue." });
    });
  };

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <Seccion n={1} titulo="Proveedor y condiciones" completa={!!proveedor && !!almacenId}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo grupo label="Tipo de compra">
            <Opciones valores={[tipo]} onToggle={(v) => cambiarTipo(v as TipoCompra)} opciones={Object.entries(TIPOS_COMPRA).map(([valor, label]) => ({ valor, label }))} />
          </Campo>
          <Campo grupo label="Llega al almacén" requerido>
            <SelectorAlmacen almacenes={almacenes} valor={almacenId} alCambiar={setAlmacenId} />
          </Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <BuscadorProveedor proveedor={proveedor} alElegir={setProveedor} />
          <Campo label={tipo === "importacion" ? "Cotización / proforma" : "Proforma"}>
            <Input value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={60} placeholder="PI-2026-077" />
          </Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo grupo label="Moneda de la mercadería">
            <Opciones valores={[moneda]} onToggle={(v) => setMoneda(v as Moneda)} opciones={[{ valor: "PEN", label: "Soles" }, { valor: "USD", label: "Dólares" }]} />
          </Campo>
          {moneda === "USD" && (
            <Campo label="TC mercadería (S/ por US$)" requerido ayuda="El del pago al proveedor">
              <Input inputMode="decimal" value={tcMerc} onChange={(e) => setTcMerc(e.target.value)} className="tnum" />
            </Campo>
          )}
          <Campo label="TC gastos (S/ por US$)" ayuda={tipo === "importacion" ? "Para flete, DAM y aduana" : "Solo si hay gastos en dólares"}>
            <Input inputMode="decimal" value={tcGastos} onChange={(e) => setTcGastos(e.target.value)} className="tnum" />
          </Campo>
          {tipo === "importacion" && (
            <Campo grupo label="Incoterm">
              <Opciones valores={incoterm ? [incoterm] : []} onToggle={(v) => setIncoterm(v as Incoterm)} opciones={[{ valor: "FOB", label: "FOB" }, { valor: "CIF", label: "CIF" }]} />
            </Campo>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo grupo label="Pago">
            <Opciones
              valores={[condicion]}
              onToggle={(v) => setCondicion(v as CondicionPago)}
              opciones={condicionesDe(tipo).map((c) => ({ valor: c, label: CONDICIONES_PAGO[c] }))}
            />
          </Campo>
          {condicion === "credito" && (
            <Campo label="Días de crédito" requerido ayuda={tipo === "importacion" ? "Desde el embarque" : "Desde la confirmación"}>
              <Input inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} placeholder="90" className="tnum" />
            </Campo>
          )}
          {tipo === "importacion" && (
            <Campo label="Embarque">
              <Input type="date" value={embarque} onChange={(e) => setEmbarque(e.target.value)} />
            </Campo>
          )}
          <Campo label="Llegada estimada">
            <Input type="date" value={llegada} onChange={(e) => setLlegada(e.target.value)} />
          </Campo>
        </div>
      </Seccion>

      <Seccion
        n={2}
        titulo="Ítems del proveedor"
        nota={filas.length > 0 ? `${filas.length} ${filas.length === 1 ? "ítem" : "ítems"}` : "Como vienen en su PDF"}
        completa={filas.length > 0}
      >
        <ComboBusqueda
          etiqueta="Buscar plancha o accesorio"
          placeholder="Código o nombre: F7E024, eco cristal 3…"
          consulta={consulta}
          alEscribir={setConsulta}
          opciones={opciones}
          cargando={false}
          error={null}
          vacio={consulta.trim() ? "Ningún producto del almacén coincide. Si es nuevo, créalo primero en Almacén." : "Escribe para buscar."}
          fresco
          enLinea
        />
        {filas.length > 0 && (
          <ul className="divide-y rounded-xl border" aria-label="Ítems de la compra">
            {filas.map((f, i) => {
              const d = descuadre({
                cantidad: leerNumero(f.cantidad) ?? 0,
                precioUnitario: leerNumero(f.precio) ?? 0,
                totalProveedor: leerNumero(f.total),
              });
              return (
                <li key={f.productoId} className="flex flex-col gap-2 px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-sm">
                      <span className="text-muted-foreground mr-2 font-mono text-xs">{f.codigo}</span>
                      {f.titulo}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Quitar ${f.codigo}`}
                      onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}
                      className="text-muted-foreground -mt-1"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Campo label="Cantidad">
                      <Input inputMode="numeric" value={f.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} className="tnum" />
                    </Campo>
                    <Campo label="Kilos (del ítem)">
                      <Input inputMode="decimal" value={f.kilos} onChange={(e) => cambiar(i, { kilos: e.target.value })} className="tnum" />
                    </Campo>
                    <Campo label={`Precio unit. (${moneda === "USD" ? "US$" : "S/"})`}>
                      <Input inputMode="decimal" value={f.precio} onChange={(e) => cambiar(i, { precio: e.target.value })} className="tnum" />
                    </Campo>
                    <Campo label="Total del PDF">
                      <Input inputMode="decimal" value={f.total} onChange={(e) => cambiar(i, { total: e.target.value })} className="tnum" placeholder="Para cuadrar" />
                    </Campo>
                  </div>
                  {d !== null && (
                    <p className="text-st-en_proceso flex items-center gap-1.5 text-xs">
                      <TriangleAlert className="size-3.5" />
                      Cantidad × precio no cuadra con el total del PDF (diferencia {montoEn(d, moneda)}).
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {filas.length > 0 && (
          <p className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
            <span>
              Mercadería: <span className="tnum text-foreground font-medium">{montoEn(total, moneda)}</span>
            </span>
            {kilos > 0 && (
              <span>
                Peso: <span className="tnum text-foreground font-medium">{kilos.toLocaleString("es-PE")} kg</span>
              </span>
            )}
          </p>
        )}
      </Seccion>

      <Seccion n={3} titulo="Nota">
        <Textarea aria-label="Nota" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={1000} rows={2} placeholder="Lo negociado, condiciones del proveedor…" />
      </Seccion>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!compra && <IndicadorBorrador estado={autoguardado.estado} />}
        {!compra && hayContenido && (
          <Button type="button" variant="outline" onClick={() => void guardarBorrador()} disabled={pendiente || autoguardado.estado === "guardando"}>
            Guardar borrador
          </Button>
        )}
        <Button variant={compra ? "outline" : "default"} onClick={() => guardar(false)} disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar pre-compra"}
        </Button>
        {compra && (
          <Button onClick={() => guardar(true)} disabled={pendiente || !odooListo} title={odooListo ? undefined : "Odoo no está configurado"}>
            Guardar y confirmar orden de compra
          </Button>
        )}
      </div>
    </div>
  );
}
