"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { toast } from "sonner";
import { HOY, PEDIDOS } from "./datos";
import {
  DOCUMENTOS,
  ESTADOS,
  LUGARES,
  METODOS,
  PRODUCTOS,
  ROLES,
  UBICACIONES,
  etiquetaTipos,
  siglaDe,
  type Estado,
  type EnvioProvincia,
  type MetodoPago,
  type LugarEntrega,
  type Pedido,
  type PlazoCredito,
  type ProductoTerminado,
  type Rol,
  type TipoDocumento,
  type TipoPago,
  type TipoPedido,
  type Ubicacion,
} from "./dominio";

/** Lo que Administración puede corregir de un pedido ya registrado. */
export interface DatosEditables {
  cliente: string;
  telefonoCliente: string | null;
  tipos: TipoPedido[];
  producto: ProductoTerminado | null;
  cantidad: number;
  entrega: LugarEntrega;
  direccion: string | null;
  detalle: string;
  observaciones: string | null;
  plazoCredito: PlazoCredito | null;
}

/** Lo que llega del formulario de registro. El código lo pone el store. */
export interface DatosNuevoPedido {
  cliente: string;
  telefonoCliente: string | null;
  tipos: TipoPedido[];
  producto: ProductoTerminado | null;
  cantidad: number;
  esProvincia: boolean;
  entrega: LugarEntrega;
  direccion: string | null;
  envio: EnvioProvincia | null;
  fechaPrometida: string;
  tipoPago: TipoPago;
  plazoCredito: PlazoCredito | null;
  montoTotal: number;
  /** Solo se usa con `tipoPago === "a_cuenta"`. Al contado se cobra el total. */
  abonoInicial: number;
  metodoPago: MetodoPago;
  responsable: string | null;
  detalle: string;
  observaciones: string | null;
}

interface Store {
  rol: Rol;
  setRol: (r: Rol) => void;
  permisos: (typeof ROLES)[Rol];
  pedidos: Pedido[];
  pedido: (codigo: string) => Pedido | undefined;
  crearPedido: (datos: DatosNuevoPedido) => string;
  cambiarEstado: (codigo: string, estado: Estado, motivo?: string) => void;
  cambiarUbicacion: (codigo: string, ubicacion: Ubicacion) => void;
  asignarResponsable: (codigo: string, responsable: string | null) => void;
  registrarAbono: (codigo: string, monto: number, metodo: MetodoPago) => void;
  editarDatos: (codigo: string, cambios: DatosEditables) => void;
  editarEnvio: (codigo: string, cambios: EnvioProvincia) => void;
  eliminarAdjunto: (codigo: string, nombre: string) => void;
}

/* Nombre de columna real y cómo se muestra cada valor en la auditoría.
   El log tiene que decir "Corte láser → Corte manual", no "CL → CM". */
const COLUMNA: Record<string, string> = {
  cliente: "nombre_cliente",
  telefonoCliente: "telefono_cliente",
  tipos: "tipos_pedido",
  producto: "tipo_producto_terminado",
  cantidad: "cantidad",
  entrega: "lugar_entrega",
  direccion: "direccion_entrega",
  detalle: "detalle",
  observaciones: "observaciones",
  plazoCredito: "plazo_credito_dias",
  departamento: "departamento",
  provincia: "provincia",
  agencia: "nombre_agencia",
  personaQueRecoge: "nombre_persona_recoge",
  tipoDocumento: "tipo_documento",
  numeroDocumento: "numero_documento",
  telefono: "telefono_persona_recoge",
  montoFlete: "monto_flete",
  fletePagado: "flete_pagado",
  observacionesEnvio: "observaciones_envio",
};

const mostrar = (campo: string, valor: unknown): string => {
  if (valor === null || valor === undefined || valor === "") return "—";
  switch (campo) {
    case "tipos":
      return etiquetaTipos(valor as TipoPedido[]);
    case "producto":
      return PRODUCTOS[valor as ProductoTerminado];
    case "entrega":
      return LUGARES[valor as LugarEntrega];
    case "tipoDocumento":
      return DOCUMENTOS[valor as TipoDocumento];
    case "plazoCredito":
      return `${valor} días`;
    case "fletePagado":
      return valor ? "pagado" : "por pagar";
    case "montoFlete":
      return `S/ ${Number(valor).toFixed(2)}`;
    default:
      return String(valor);
  }
};

/** `tipos` es un array: comparado por referencia siempre parecería haber cambiado. */
const mismoValor = (a: unknown, b: unknown) =>
  Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
    : (a ?? null) === (b ?? null);

const Ctx = createContext<Store | null>(null);

/**
 * "Ahora" en el prototipo es HOY con la hora real del reloj, no la fecha de la
 * máquina. Si fuera la fecha real, un pedido entregado hoy quedaría cerrado "en
 * el futuro" respecto a HOY y saldría de la lista en el mismo clic.
 * Con Supabase esto pasa a ser `now()` en el servidor.
 */
const ahora = () => `${HOY}T${new Date().toTimeString().slice(0, 5)}`;

/* El código se dicta por teléfono, así que el alfabeto no tiene
   caracteres que se confundan al oído ni a la vista (O/0, I/1). */
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const sufijo = () =>
  Array.from({ length: 4 }, () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]).join("");

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [rol, setRolState] = useState<Rol>("administracion");
  const [pedidos, setPedidos] = useState<Pedido[]>(PEDIDOS);

  const usuarioActual = ROLES[rol].nombre;

  const editar = useCallback(
    (codigo: string, fn: (p: Pedido) => Pedido) =>
      setPedidos((prev) => prev.map((p) => (p.codigo === codigo ? fn(p) : p))),
    [],
  );

  const registrarCambio = (
    p: Pedido,
    campo: string,
    anterior: string,
    nuevo: string,
    usuario: string,
  ): Pedido["auditoria"] => [{ usuario, campo, anterior, nuevo, fecha: ahora() }, ...p.auditoria];

  /**
   * Registrar un pedido. `contado` cobra el total en el acto y deja el abono hecho;
   * `a_cuenta` cobra lo que se haya adelantado; `credito` no cobra nada todavía.
   */
  const crearPedido = useCallback(
    (datos: DatosNuevoPedido) => {
      const codigo = `${datos.esProvincia ? "P" : "L"}${siglaDe(datos.tipos)}_${HOY.slice(0, 4)}_${sufijo()}`;

      const montoPagado =
        datos.tipoPago === "contado"
          ? datos.montoTotal
          : datos.tipoPago === "a_cuenta"
            ? Math.min(datos.abonoInicial, datos.montoTotal)
            : 0;

      const nuevo: Pedido = {
        codigo,
        cliente: datos.cliente,
        telefonoCliente: datos.telefonoCliente,
        tipos: datos.tipos,
        producto: datos.tipos.includes("PT") ? datos.producto : null,
        cantidad: datos.cantidad,
        estado: "registrado",
        motivo: null,
        // Un pedido nace donde se registra; el taller lo mueve cuando lo recoge.
        ubicacion: datos.entrega === "taller" ? "taller" : "tienda",
        entrega: datos.entrega,
        direccion: datos.entrega === "domicilio" ? datos.direccion : null,
        fechaPrometida: datos.fechaPrometida,
        fechaCreacion: HOY,
        fechaEntrega: null,
        fechaAnulacion: null,
        tipoPago: datos.tipoPago,
        plazoCredito: datos.tipoPago === "credito" ? datos.plazoCredito : null,
        montoTotal: datos.montoTotal,
        montoPagado,
        responsable: datos.responsable,
        detalle: datos.detalle,
        observaciones: datos.observaciones,
        numeroFactura: null,
        esProvincia: datos.esProvincia,
        envio: datos.esProvincia && datos.envio ? datos.envio : undefined,
        adjuntos: [],
        abonos:
          montoPagado > 0
            ? [{ fecha: HOY, monto: montoPagado, metodo: datos.metodoPago, usuario: usuarioActual }]
            : [],
        historial: [{ estado: "registrado", usuario: usuarioActual, rol, fecha: ahora() }],
        auditoria: [],
      };

      setPedidos((prev) => [nuevo, ...prev]);

      const saldo = datos.montoTotal - montoPagado;
      toast.success(`Pedido ${codigo} registrado`, {
        description: `${datos.cliente} · entrega ${
          datos.esProvincia ? "a provincia" : LUGARES[datos.entrega].toLowerCase()
        } · ${saldo > 0 ? `saldo de S/ ${saldo.toFixed(2)}` : "pagado"}`,
      });

      return codigo;
    },
    [rol, usuarioActual],
  );

  const cambiarEstado = useCallback(
    (codigo: string, estado: Estado, motivo?: string) => {
      if (pedidos.find((p) => p.codigo === codigo)?.estado === estado) return;
      editar(codigo, (p) => ({
        ...p,
        estado,
        motivo: motivo ?? (estado === "observado" || estado === "anulado" ? p.motivo : null),
        fechaEntrega: estado === "entregado" ? ahora().slice(0, 10) : p.fechaEntrega,
        // Anular también cierra el pedido, y hay que poder saber qué día fue.
        fechaAnulacion: estado === "anulado" ? ahora().slice(0, 10) : p.fechaAnulacion,
        historial: [
          ...p.historial,
          { estado, usuario: usuarioActual, rol, fecha: ahora(), motivo: motivo ?? null },
        ],
        auditoria: registrarCambio(p, "estado", ESTADOS[p.estado], ESTADOS[estado], usuarioActual),
      }));
      toast.success(`${codigo} → ${ESTADOS[estado]}`, {
        description: `Registrado por ${usuarioActual}`,
      });
    },
    [editar, pedidos, rol, usuarioActual],
  );

  const cambiarUbicacion = useCallback(
    (codigo: string, ubicacion: Ubicacion) => {
      // Un cambio que no cambia nada no se registra: el trigger de Postgres hará lo mismo.
      if (pedidos.find((p) => p.codigo === codigo)?.ubicacion === ubicacion) return;
      editar(codigo, (p) => ({
        ...p,
        ubicacion,
        auditoria: registrarCambio(
          p,
          "ubicacion_actual",
          UBICACIONES[p.ubicacion],
          UBICACIONES[ubicacion],
          usuarioActual,
        ),
      }));
      toast.success(`${codigo} ahora está ${UBICACIONES[ubicacion].toLowerCase()}`);
    },
    [editar, pedidos, usuarioActual],
  );

  const asignarResponsable = useCallback(
    (codigo: string, responsable: string | null) => {
      if (pedidos.find((p) => p.codigo === codigo)?.responsable === responsable) return;
      editar(codigo, (p) => ({
        ...p,
        responsable,
        auditoria: registrarCambio(
          p,
          "responsable_id",
          p.responsable ?? "—",
          responsable ?? "—",
          usuarioActual,
        ),
      }));
      toast.success(
        responsable ? `${codigo} asignado a ${responsable}` : `${codigo} quedó sin responsable`,
      );
    },
    [editar, pedidos, usuarioActual],
  );

  const registrarAbono = useCallback(
    (codigo: string, monto: number, metodo: MetodoPago) => {
      const actual = pedidos.find((p) => p.codigo === codigo);
      if (!actual) return;

      // El saldo no puede quedar negativo: es una columna generada en Postgres.
      const saldo = actual.montoTotal - actual.montoPagado;
      if (monto <= 0 || monto > saldo) {
        toast.error("Abono no registrado", {
          description: `El monto debe estar entre S/ 0.01 y el saldo de S/ ${saldo.toFixed(2)}.`,
        });
        return;
      }

      const soles = (n: number) => `S/ ${n.toFixed(2)}`;
      editar(codigo, (p) => ({
        ...p,
        montoPagado: p.montoPagado + monto,
        abonos: [
          ...p.abonos,
          { fecha: ahora().slice(0, 10), monto, metodo, usuario: usuarioActual },
        ],
        auditoria: registrarCambio(
          p,
          "monto_pagado",
          soles(p.montoPagado),
          soles(p.montoPagado + monto),
          usuarioActual,
        ),
      }));

      const restante = saldo - monto;
      toast.success(`Abono de ${soles(monto)} registrado`, {
        description:
          restante > 0
            ? `${METODOS[metodo]} · queda un saldo de ${soles(restante)}`
            : `${METODOS[metodo]} · el pedido queda pagado`,
      });
    },
    [editar, pedidos, usuarioActual],
  );

  /** Compara lo enviado contra lo guardado y deja una fila de auditoría por campo cambiado. */
  const aplicarCambios = useCallback(
    (codigo: string, cambios: Record<string, unknown>, aplicar: (p: Pedido) => Pedido) => {
      const actual = pedidos.find((p) => p.codigo === codigo);
      if (!actual) return 0;

      const previo: Record<string, unknown> = {
        ...(actual as unknown as Record<string, unknown>),
        ...(actual.envio ?? {}),
      };
      const entradas = Object.entries(cambios).filter(
        ([campo, valor]) => !mismoValor(previo[campo], valor),
      );
      if (entradas.length === 0) {
        toast("Sin cambios que guardar");
        return 0;
      }

      editar(codigo, (p) => ({
        ...aplicar(p),
        auditoria: [
          ...entradas.map(([campo, valor]) => ({
            usuario: usuarioActual,
            campo: COLUMNA[campo] ?? campo,
            anterior: mostrar(campo, previo[campo]),
            nuevo: mostrar(campo, valor),
            fecha: ahora(),
          })),
          ...p.auditoria,
        ],
      }));
      return entradas.length;
    },
    [editar, pedidos, usuarioActual],
  );

  const editarDatos = useCallback(
    (codigo: string, cambios: DatosEditables) => {
      const n = aplicarCambios(codigo, cambios as unknown as Record<string, unknown>, (p) => ({
        ...p,
        ...cambios,
        // Un pedido que deja de incluir producto terminado no puede conservar el producto
        producto: cambios.tipos.includes("PT") ? cambios.producto : null,
        direccion: cambios.entrega === "domicilio" ? cambios.direccion : null,
        // El plazo solo existe mientras el pedido sea al crédito
        plazoCredito: p.tipoPago === "credito" ? cambios.plazoCredito : null,
      }));
      if (n > 0) {
        toast.success(`${codigo} actualizado`, {
          description: `${n} ${n === 1 ? "campo corregido" : "campos corregidos"} · queda en la auditoría`,
        });
      }
    },
    [aplicarCambios],
  );

  const editarEnvio = useCallback(
    (codigo: string, cambios: EnvioProvincia) => {
      const n = aplicarCambios(codigo, cambios as unknown as Record<string, unknown>, (p) => ({
        ...p,
        envio: { ...p.envio, ...cambios },
      }));
      if (n > 0) {
        toast.success(`Envío de ${codigo} actualizado`, {
          description: `${n} ${n === 1 ? "campo corregido" : "campos corregidos"}`,
        });
      }
    },
    [aplicarCambios],
  );

  /**
   * Borrar un adjunto es irreversible, así que queda registrado en la auditoría:
   * el archivo se va, pero el rastro de quién lo borró y cuándo no.
   */
  const eliminarAdjunto = useCallback(
    (codigo: string, nombre: string) => {
      editar(codigo, (p) => ({
        ...p,
        adjuntos: p.adjuntos.filter((a) => a.nombre !== nombre),
        auditoria: registrarCambio(p, "adjuntos", nombre, "eliminado", usuarioActual),
      }));
      toast.success("Archivo eliminado", {
        description: `${nombre} · queda registrado en la auditoría de ${codigo}`,
      });
    },
    [editar, usuarioActual],
  );

  const setRol = useCallback((r: Rol) => {
    setRolState(r);
    toast(`Ahora ves la app como ${ROLES[r].nombre}`, { description: ROLES[r].descripcion });
  }, []);

  const value = useMemo<Store>(
    () => ({
      rol,
      setRol,
      permisos: ROLES[rol],
      pedidos,
      pedido: (codigo) => pedidos.find((p) => p.codigo === codigo),
      crearPedido,
      cambiarEstado,
      cambiarUbicacion,
      asignarResponsable,
      registrarAbono,
      editarDatos,
      editarEnvio,
      eliminarAdjunto,
    }),
    [
      rol,
      setRol,
      pedidos,
      crearPedido,
      cambiarEstado,
      cambiarUbicacion,
      asignarResponsable,
      registrarAbono,
      editarDatos,
      editarEnvio,
      eliminarAdjunto,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore debe usarse dentro de StoreProvider");
  return ctx;
}
