"use client";

import { createContext, useCallback, useContext, useMemo, useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { hoy } from "./fecha";
import * as acciones from "@/app/(app)/acciones";
import type { Resultado } from "@/app/(app)/acciones";
import type { Departamento, Trabajador } from "./catalogos-servidor";
import type { z } from "zod";
import type { DatosEditables, DatosEnvio, esquemaRegistroPedido } from "./esquemas";
import {
  ESTADOS,
  LUGARES,
  METODOS,
  ROLES,
  UBICACIONES,
  saldoDe,
  type Estado,
  type MetodoPago,
  type Pedido,
  type Rol,
  type Ubicacion,
} from "./dominio";

interface Store {
  rol: Rol;
  /** Nombre de quien tiene la sesión abierta. Firma el historial y la auditoría. */
  usuario: string;
  permisos: (typeof ROLES)[Rol];
  pedidos: Pedido[];
  /** Catálogos de la base: lo que alimenta los desplegables que escriben ids. */
  trabajadores: Trabajador[];
  ubigeo: Departamento[];
  /** Hay una escritura en vuelo. Sirve para deshabilitar botones. */
  pendiente: boolean;
  pedido: (codigo: string) => Pedido | undefined;
  /** `cliente` es solo para el aviso: el nombre que vale lo lee el servidor de Odoo. */
  registrarPedido: (datos: z.input<typeof esquemaRegistroPedido>, cliente: string) => Promise<Resultado>;
  cambiarEstado: (
    codigo: string,
    estado: Estado,
    extra?: CambioEstadoExtra,
  ) => Promise<Resultado>;
  cambiarUbicacion: (codigo: string, ubicacion: Ubicacion) => Promise<Resultado>;
  asignarResponsable: (codigo: string, responsableId: string | null) => Promise<Resultado>;
  registrarAbono: (codigo: string, monto: number, metodo: MetodoPago) => Promise<Resultado>;
  editarDatos: (codigo: string, cambios: DatosEditables) => Promise<Resultado>;
  editarEnvio: (codigo: string, cambios: DatosEnvio) => Promise<Resultado>;
}

/** Lo que acompaña a un cambio de estado, según a dónde va. */
export interface CambioEstadoExtra {
  motivo?: string | null;
  numeroComprobante?: string | null;
  /** Al pasar a Listo: las planchas que de verdad se usaron en cada corte. */
  planchas?: { posicion: number; planchas: number }[];
  /** Y, en los cortes con piloto de sobrantes, los pedazos que se guardaron. */
  sobrantes?: { posicion: number; piezas: { largo: number; ancho: number; ubicacion: string | null }[] }[];
  /** Y lo que de verdad se usó en cada producto terminado. */
  materiales?: { posicion: number; usados: { productoId: number; cantidad: number }[] }[];
}

const Ctx = createContext<Store | null>(null);

/** Un cambio pintado antes de que el servidor conteste. */
interface Parche {
  codigo: string;
  cambios: Partial<Pedido>;
}

const soles = (n: number) => `S/ ${n.toFixed(2)}`;

/** Nada que guardar: se avisa igual, porque un clic sin efecto ni aviso parece un fallo. */
const sinCambios = (): Resultado => {
  toast("Sin cambios que guardar");
  return { ok: true };
};

/**
 * El rol y el nombre llegan de la sesión, resueltos en el servidor por el layout
 * de `(app)`. Nadie los elige desde el navegador.
 */
export function StoreProvider({
  children,
  rol,
  usuario,
  pedidos: delServidor,
  trabajadores,
  ubigeo,
}: {
  children: React.ReactNode;
  rol: Rol;
  usuario: string;
  pedidos: Pedido[];
  trabajadores: Trabajador[];
  ubigeo: Departamento[];
}) {
  /*
   * Los pedidos son los del servidor, no una copia editable: cada Server Action
   * termina en `refresh()`, que vuelve a renderizar este layout y los trae de
   * nuevo. Lo único que se guarda en el navegador es el cambio en vuelo, y solo
   * mientras dura la transición: si el servidor lo rechaza, React descarta el
   * valor optimista él solo y la pantalla vuelve a la verdad de la base.
   */
  const [pedidos, aplicarParche] = useOptimistic(
    delServidor,
    (previos: Pedido[], parche: Parche) =>
      previos.map((p) => (p.codigo === parche.codigo ? { ...p, ...parche.cambios } : p)),
  );

  const [pendiente, iniciarTransicion] = useTransition();

  /**
   * El patrón de toda escritura: pintar el cambio, llamar a la acción, y contar el
   * resultado. Va envuelto en una promesa porque el `await` tiene que ocurrir
   * *dentro* de la transición —si no, React la da por terminada y el parche
   * optimista desaparece antes de que conteste el servidor—, pero los diálogos
   * necesitan saber si cerrarse o no.
   */
  const mutar = useCallback(
    (
      parche: Parche | null,
      accion: () => Promise<Resultado>,
      alExito?: (resultado: Resultado & { ok: true }) => void,
    ): Promise<Resultado> =>
      new Promise((resolver) => {
        iniciarTransicion(async () => {
          if (parche) aplicarParche(parche);
          const resultado = await accion();
          if (resultado.ok) alExito?.(resultado);
          else toast.error("No se guardó", { description: resultado.error });
          resolver(resultado);
        });
      }),
    [aplicarParche],
  );

  const buscar = useCallback(
    (codigo: string) => delServidor.find((p) => p.codigo === codigo),
    [delServidor],
  );

  const registrarPedido = useCallback(
    async (datos: z.input<typeof esquemaRegistroPedido>, cliente: string) => {
      // Sin parche optimista: el pedido todavía no tiene código, y el código lo
      // inventa Postgres. Se espera y se navega.
      const resultado = await acciones.registrarPedido(datos);
      if (!resultado.ok) {
        toast.error("No se registró el pedido", { description: resultado.error });
        return resultado;
      }

      // El total lo puso el servidor: sale de Odoo, con sus impuestos.
      const total = resultado.total ?? 0;
      const cobrado =
        datos.tipoPago === "contado"
          ? total
          : datos.tipoPago === "a_cuenta"
            ? Math.min(datos.abonoInicial, total)
            : 0;
      const saldo = total - cobrado;

      toast.success(`Pedido ${resultado.codigo} registrado`, {
        description: `${cliente} · ${soles(total)} · entrega ${
          datos.esProvincia ? "a provincia" : LUGARES[datos.entrega].toLowerCase()
        } · ${saldo > 0 ? `saldo de ${soles(saldo)}` : "pagado"}`,
      });
      if (resultado.aviso) {
        toast.warning("El pedido quedó registrado, pero falta Odoo", {
          description: `${resultado.aviso} Se reintenta desde la cotización del pedido.`,
          duration: 12_000,
        });
      }
      return resultado;
    },
    [],
  );

  const cambiarEstado = useCallback(
    (
      codigo: string,
      estado: Estado,
      extra?: CambioEstadoExtra,
    ) => {
      const actual = buscar(codigo);
      if (!actual) return Promise.resolve(sinCambios());
      if (actual.estado === estado) return Promise.resolve(sinCambios());

      const motivo = extra?.motivo?.trim() || null;
      const numeroComprobante = extra?.numeroComprobante?.trim() || null;

      return mutar(
        {
          codigo,
          cambios: {
            estado,
            motivo,
            // Las dos fechas de cierre las escribe la base; se adelantan aquí solo
            // para que el pedido no salte de vista y vuelva mientras se guarda.
            fechaEntrega: estado === "entregado" ? hoy() : null,
            fechaAnulacion: estado === "anulado" ? hoy() : null,
            tieneComprobante: actual.tieneComprobante || Boolean(numeroComprobante),
          },
        },
        () => acciones.cambiarEstado({
            codigo,
            estado,
            motivo,
            numeroComprobante,
            planchas: extra?.planchas,
            sobrantes: extra?.sobrantes,
            materiales: extra?.materiales,
          }),
        (r) => {
          toast.success(`${codigo} → ${ESTADOS[estado]}`, {
            description: `Registrado por ${usuario}`,
          });
          // El pedido se movió, pero Odoo no hizo su parte: se reintenta desde el detalle.
          if (r.aviso) toast.warning("Falta Odoo", { description: r.aviso, duration: 12_000 });
        },
      );
    },
    [buscar, mutar, usuario],
  );

  const cambiarUbicacion = useCallback(
    (codigo: string, ubicacion: Ubicacion) => {
      if (buscar(codigo)?.ubicacion === ubicacion) return Promise.resolve(sinCambios());

      return mutar(
        { codigo, cambios: { ubicacion } },
        () => acciones.cambiarUbicacion({ codigo, ubicacion }),
        () => toast.success(`${codigo} ahora está ${UBICACIONES[ubicacion].toLowerCase()}`),
      );
    },
    [buscar, mutar],
  );

  const asignarResponsable = useCallback(
    (codigo: string, responsableId: string | null) => {
      if ((buscar(codigo)?.responsableId ?? null) === responsableId) {
        return Promise.resolve(sinCambios());
      }
      const nombre = trabajadores.find((t) => t.id === responsableId)?.nombre ?? null;

      return mutar(
        { codigo, cambios: { responsableId, responsable: nombre } },
        () => acciones.asignarResponsable({ codigo, responsableId }),
        () =>
          toast.success(
            nombre ? `${codigo} asignado a ${nombre}` : `${codigo} quedó sin responsable`,
          ),
      );
    },
    [buscar, mutar, trabajadores],
  );

  const registrarAbono = useCallback(
    (codigo: string, monto: number, metodo: MetodoPago) => {
      const actual = buscar(codigo);
      if (!actual) return Promise.resolve(sinCambios());

      const restante = saldoDe(actual) - monto;
      return mutar(
        {
          codigo,
          cambios: {
            montoPagado: actual.montoPagado + monto,
            abonos: [...actual.abonos, { fecha: hoy(), monto, metodo, usuario }],
          },
        },
        () => acciones.registrarAbono({ codigo, monto, metodo }),
        () =>
          toast.success(`Abono de ${soles(monto)} registrado`, {
            description:
              restante > 0
                ? `${METODOS[metodo]} · queda un saldo de ${soles(restante)}`
                : `${METODOS[metodo]} · el pedido queda pagado`,
          }),
      );
    },
    [buscar, mutar, usuario],
  );

  const editarDatos = useCallback(
    (codigo: string, cambios: DatosEditables) =>
      mutar(
        {
          codigo,
          cambios: {
            cliente: cambios.cliente,
            telefonoCliente: cambios.telefonoCliente,
            tipos: cambios.tipos,
            producto: cambios.tipos.includes("PT") ? cambios.producto : null,
            cantidad: cambios.cantidad,
            entrega: cambios.entrega,
            direccion: cambios.entrega === "domicilio" ? cambios.direccion : null,
            detalle: cambios.detalle,
            observaciones: cambios.observaciones,
            plazoCredito: cambios.plazoCredito,
          },
        },
        () => acciones.editarDatos(codigo, cambios),
        () =>
          toast.success(`${codigo} actualizado`, {
            description: "Cada campo corregido queda en la auditoría",
          }),
      ),
    [mutar],
  );

  const editarEnvio = useCallback(
    (codigo: string, cambios: DatosEnvio) => {
      const departamento = ubigeo.find((d) => d.id === cambios.departamentoId);
      const provincia = departamento?.provincias.find((p) => p.id === cambios.provinciaId);
      const previo = buscar(codigo)?.envio;

      return mutar(
        {
          codigo,
          cambios: {
            envio: {
              ...previo,
              ...cambios,
              // El parche pinta nombres porque es lo que se lee en pantalla; a la
              // base van los ids, que es lo que valida la FK compuesta.
              departamento: departamento?.nombre ?? previo?.departamento ?? "",
              provincia: provincia?.nombre ?? null,
            },
          },
        },
        () => acciones.editarEnvio(codigo, cambios),
        () => toast.success(`Envío de ${codigo} actualizado`),
      );
    },
    [buscar, mutar, ubigeo],
  );

  const value = useMemo<Store>(
    () => ({
      rol,
      usuario,
      permisos: ROLES[rol],
      pedidos,
      trabajadores,
      ubigeo,
      pendiente,
      pedido: (codigo) => pedidos.find((p) => p.codigo === codigo),
      registrarPedido,
      cambiarEstado,
      cambiarUbicacion,
      asignarResponsable,
      registrarAbono,
      editarDatos,
      editarEnvio,
    }),
    [
      rol,
      usuario,
      pedidos,
      trabajadores,
      ubigeo,
      pendiente,
      registrarPedido,
      cambiarEstado,
      cambiarUbicacion,
      asignarResponsable,
      registrarAbono,
      editarDatos,
      editarEnvio,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore debe usarse dentro de StoreProvider");
  return ctx;
}
