"use client";

/**
 * El texto de un mensaje con sus fichas @ pintadas.
 *
 * PROVISORIO: es el contrato que usan las burbujas. La versión con fichas que
 * abren el pedido, el diseño o una tarjeta del cliente la reemplaza sin cambiar
 * las props.
 */

import type { Referencia } from "@/lib/chat/tipos";
import { partirReferencias } from "@/lib/chat/tipos";

export interface PropsTextoConReferencias {
  texto: string;
  referencias: Referencia[];
  /** El mensaje es de quien mira: la burbuja tiene fondo de color primario. */
  propio?: boolean;
}

export function TextoConReferencias({ texto, referencias }: PropsTextoConReferencias) {
  return (
    <>
      {partirReferencias(texto, referencias).map((t, i) =>
        typeof t === "string" ? (
          <span key={i}>{t}</span>
        ) : (
          <span key={i} className="font-medium underline decoration-dotted">
            @{t.etiqueta}
          </span>
        ),
      )}
    </>
  );
}
