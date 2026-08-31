import { ROLES, type Pedido, type Rol } from "./dominio";
import { diaEnLima, momentoEnLima } from "./fecha";
import { clienteServidor } from "./supabase-servidor";

/**
 * Lee los pedidos de Supabase y los devuelve con la forma que espera la UI.
 *
 * Cada rol consulta **su** vista: el taller no puede pedir columnas que no ve
 * ni aunque quisiera, porque no existen en `pedidos_operaciones`. Lo que falta
 * en una vista llega aquí como hueco (cliente vacío, montos en cero), y la UI ya
 * sabe no pintarlo — los permisos de `dominio.ts` y los de Postgres dicen lo
 * mismo. Nada de esto es la seguridad: la seguridad es la RLS.
 */

const VISTA_POR_ROL = {
  administracion: "pedidos_admin",
  logistica: "pedidos_logistica",
  operaciones: "pedidos_operaciones",
} as const;

/** Las vistas devuelven todas las columnas como nullable; esto lo aterriza. */
type Fila = Record<string, unknown>;

const texto = (v: unknown): string => (typeof v === "string" ? v : "");
const textoONulo = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const numero = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** 860160 → "840 KB". El peso se enseña, no se calcula con él. */
export function pesoTexto(bytes: number | null): string {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export async function cargarPedidos(rol: Rol): Promise<Pedido[]> {
  const supabase = await clienteServidor();
  const permisos = ROLES[rol];

  const { data: filas, error } = await supabase
    .from(VISTA_POR_ROL[rol])
    .select("*")
    .order("fecha_prometida", { ascending: true });

  if (error) throw new Error(`No se pudieron leer los pedidos: ${error.message}`);
  if (!filas?.length) return [];

  const ids = filas.map((f) => (f as Fila).id as string).filter(Boolean);

  // Las colecciones se piden de una vez para todos los pedidos, no una consulta
  // por tarjeta. La RLS ya recorta lo que cada rol puede ver de cada tabla.
  const [adjuntos, historial, abonos, auditoria] = await Promise.all([
    supabase
      .from("adjuntos")
      .select("pedido_id, tipo, nombre_archivo, tamano_bytes")
      .in("pedido_id", ids),
    supabase
      .from("historial_pedido")
      .select("pedido_id, estado, rol, motivo, creado_en, usuario")
      .in("pedido_id", ids)
      .order("creado_en", { ascending: true }),
    // Sin permiso de montos la consulta volvería vacía por RLS; mejor no hacerla.
    permisos.verMontos
      ? supabase
          .from("pagos_pedido")
          .select("pedido_id, monto, metodo, fecha, usuario")
          .in("pedido_id", ids)
          .order("fecha", { ascending: true })
      : null,
    permisos.verAuditoria
      ? supabase
          .from("auditoria_pedido")
          .select("pedido_id, campo, valor_anterior, valor_nuevo, creado_en, usuario")
          .in("pedido_id", ids)
          .order("creado_en", { ascending: false })
      : null,
  ]);

  const agrupar = <T extends { pedido_id: string | null }>(datos: T[] | null | undefined) => {
    const mapa = new Map<string, T[]>();
    for (const fila of datos ?? []) {
      if (!fila.pedido_id) continue;
      const lista = mapa.get(fila.pedido_id);
      if (lista) lista.push(fila);
      else mapa.set(fila.pedido_id, [fila]);
    }
    return mapa;
  };

  const porPedido = {
    adjuntos: agrupar(adjuntos.data),
    historial: agrupar(historial.data),
    abonos: agrupar(abonos?.data),
    auditoria: agrupar(auditoria?.data),
  };

  return filas.map((cruda) => {
    const f = cruda as Fila;
    const id = f.id as string;

    return {
      codigo: texto(f.codigo),
      // El taller no recibe el nombre del cliente: su vista no tiene la columna.
      cliente: texto(f.nombre_cliente),
      telefonoCliente: textoONulo(f.telefono_cliente),
      tipos: (f.tipos_pedido as Pedido["tipos"]) ?? [],
      producto: (f.tipo_producto_terminado as Pedido["producto"]) ?? null,
      cantidad: numero(f.cantidad),
      estado: f.estado as Pedido["estado"],
      motivo: textoONulo(f.motivo),
      ubicacion: f.ubicacion_actual as Pedido["ubicacion"],
      entrega: f.lugar_entrega as Pedido["entrega"],
      direccion: textoONulo(f.direccion_entrega),
      fechaPrometida: texto(f.fecha_prometida),
      fechaCreacion: diaEnLima(texto(f.fecha_creacion)),
      fechaEntrega: textoONulo(f.fecha_entrega),
      fechaAnulacion: textoONulo(f.fecha_anulacion),
      // Sin permiso de montos estos campos no vienen: quedan en cero y la UI no
      // los pinta. No hay forma de que un cero se confunda con un precio real,
      // porque la sección entera está oculta para ese rol.
      tipoPago: (f.tipo_pago as Pedido["tipoPago"]) ?? "contado",
      plazoCredito: (f.plazo_credito_dias as Pedido["plazoCredito"]) ?? null,
      montoTotal: numero(f.monto_total),
      montoPagado: numero(f.monto_pagado),
      responsable: textoONulo(f.responsable),
      responsableId: textoONulo(f.responsable_id),
      detalle: texto(f.detalle),
      observaciones: textoONulo(f.observaciones),
      numeroFactura: textoONulo(f.numero_factura),
      // Las tres vistas lo traen; el número, solo la de Administración.
      tieneFactura: Boolean(f.tiene_factura),
      esProvincia: Boolean(f.es_provincia),
      envio: f.es_provincia
        ? {
            departamento: texto(f.departamento),
            provincia: textoONulo(f.provincia),
            // Operaciones ve el nombre del destino pero no los ids: no escribe envíos.
            departamentoId: (f.departamento_id as number | null) ?? null,
            provinciaId: (f.provincia_id as number | null) ?? null,
            agencia: textoONulo(f.nombre_agencia),
            personaQueRecoge: textoONulo(f.nombre_persona_recoge),
            tipoDocumento: (f.tipo_documento as "DNI" | "CE") ?? "DNI",
            numeroDocumento: textoONulo(f.numero_documento),
            telefono: textoONulo(f.telefono_persona_recoge),
            montoFlete: numero(f.monto_flete),
            fletePagado: Boolean(f.flete_pagado),
            observacionesEnvio: textoONulo(f.observaciones_envio),
          }
        : undefined,
      adjuntos: (porPedido.adjuntos.get(id) ?? []).map((a) => ({
        tipo: a.tipo,
        nombre: a.nombre_archivo,
        peso: pesoTexto(a.tamano_bytes),
      })),
      abonos: (porPedido.abonos.get(id) ?? []).map((a) => ({
        fecha: diaEnLima(a.fecha),
        monto: numero(a.monto),
        metodo: a.metodo!,
        usuario: a.usuario ?? "—",
      })),
      historial: (porPedido.historial.get(id) ?? []).map((h) => ({
        estado: h.estado!,
        usuario: h.usuario ?? "—",
        rol: h.rol!,
        fecha: momentoEnLima(h.creado_en),
        motivo: h.motivo,
      })),
      auditoria: (porPedido.auditoria.get(id) ?? []).map((a) => ({
        usuario: a.usuario ?? "—",
        campo: a.campo!,
        anterior: a.valor_anterior ?? "—",
        nuevo: a.valor_nuevo ?? "—",
        fecha: momentoEnLima(a.creado_en),
      })),
    } satisfies Pedido;
  });
}
