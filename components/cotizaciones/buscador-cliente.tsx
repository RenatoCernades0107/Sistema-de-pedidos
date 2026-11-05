"use client";

import { useState, type Ref } from "react";
import { Building2, Phone, UserPlus, UserRound, X } from "lucide-react";
import { tipoDeDocumento } from "@/lib/busqueda-inteligente";
import type { ClienteOdoo, Resultado } from "@/lib/odoo/tipos";
import { Button } from "@/components/ui/button";
import { ComboBusqueda, type Opcion } from "./combo-busqueda";
import { CrearCliente } from "./crear-cliente";
import { Resaltado } from "./resaltado";
import { buscarUnaVez, useBusqueda } from "./use-busqueda";

const RUTA = "/api/cotizaciones/buscar/clientes";

/**
 * Elegir el cliente de Odoo. Vacío, ofrece los últimos cotizados; con texto,
 * busca por nombre, RUC/DNI, teléfono o correo. Si no está, se crea ahí mismo.
 * Elegido, se vuelve una tarjeta con "Cambiar".
 */
export function BuscadorCliente({
  cliente,
  alElegir,
  inputRef,
  autoFocus,
}: {
  cliente: ClienteOdoo | null;
  alElegir: (cliente: ClienteOdoo | null) => void;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
}) {
  const [consulta, setConsulta] = useState("");
  const [crearCon, setCrearCon] = useState<string | null>(null);
  const busqueda = useBusqueda<ClienteOdoo>(RUTA, consulta, !cliente);
  const q = consulta.trim();

  const elegir = (c: ClienteOdoo) => {
    setConsulta("");
    alElegir(c);
  };

  if (cliente) {
    return <TarjetaCliente cliente={cliente} alCambiar={() => alElegir(null)} />;
  }

  const opciones: Opcion[] = busqueda.resultados.map((r) => ({
    valor: `cliente-${r.item.id}`,
    alElegir: () => elegir(r.item),
    contenido: <FilaCliente resultado={r} consulta={q} />,
  }));

  const extra: Opcion[] = [
    {
      valor: "crear-cliente",
      alElegir: () => setCrearCon(q),
      contenido: (
        <>
          <UserPlus className="text-primary size-4 shrink-0" />
          <span className="min-w-0 truncate">
            {q ? (
              <>
                Crear cliente <span className="font-medium">«{q}»</span>
              </>
            ) : (
              "Crear cliente nuevo"
            )}
          </span>
        </>
      ),
    },
  ];

  return (
    <>
      <ComboBusqueda
        etiqueta="Buscar cliente"
        placeholder="Nombre, RUC, DNI o teléfono…"
        consulta={consulta}
        alEscribir={setConsulta}
        opciones={opciones}
        extra={extra}
        titulo={busqueda.origen === "recientes" ? "Cotizados hace poco" : undefined}
        cargando={busqueda.cargando}
        error={busqueda.error}
        vacio={q ? "Ningún cliente coincide en Odoo." : "Todavía no hay clientes cotizados."}
        fresco={!busqueda.cargando && busqueda.consultaRespondida === q}
        alEnterSinRespuesta={async () => {
          // Un RUC pegado y Enter: si coincide exacto, se elige sin esperar al debounce.
          const r = await buscarUnaVez<ClienteOdoo>(`${RUTA}?q=${encodeURIComponent(q)}`);
          const primero = r?.resultados[0];
          if (primero?.porCodigo === "exacto") elegir(primero.item);
        }}
        inputRef={inputRef}
        autoFocus={autoFocus}
      />
      <CrearCliente
        abierto={crearCon !== null}
        textoInicial={crearCon ?? ""}
        alCerrar={() => setCrearCon(null)}
        alCrear={(c) => {
          setCrearCon(null);
          busqueda.olvidar();
          elegir(c);
        }}
      />
    </>
  );
}

function FilaCliente({ resultado, consulta }: { resultado: Resultado<ClienteOdoo>; consulta: string }) {
  const c = resultado.item;
  const Icono = c.esEmpresa ? Building2 : UserRound;
  return (
    <>
      <Icono className="text-muted-foreground size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <Resaltado texto={c.nombre} consulta={consulta} className="truncate" />
        <span className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
          {c.documento && <Documento documento={c.documento} consulta={consulta} />}
          {c.telefono && <span className="tnum">{c.telefono}</span>}
          {(c.empresa || c.ciudad) && <span className="truncate">{c.empresa ?? c.ciudad}</span>}
        </span>
      </span>
      {resultado.veces ? (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {resultado.veces} {resultado.veces === 1 ? "cotización" : "cotizaciones"}
        </span>
      ) : null}
    </>
  );
}

function Documento({ documento, consulta = "" }: { documento: string; consulta?: string }) {
  const tipo = tipoDeDocumento(documento.replace(/^PE/i, ""));
  return (
    <span className="tnum">
      {tipo && <span className="text-muted-foreground mr-1 font-medium">{tipo}</span>}
      <Resaltado texto={documento} consulta={consulta} codigo />
    </span>
  );
}

function TarjetaCliente({ cliente, alCambiar }: { cliente: ClienteOdoo; alCambiar: () => void }) {
  const Icono = cliente.esEmpresa ? Building2 : UserRound;
  return (
    <div
      className="bg-primary/[0.04] border-primary/30 flex items-start gap-3 rounded-lg border p-3"
      data-testid="cliente-elegido"
    >
      <span className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-full">
        <Icono className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{cliente.nombre}</p>
        <p className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs">
          {cliente.documento ? <Documento documento={cliente.documento} /> : <span>Sin RUC/DNI</span>}
          {cliente.telefono && (
            <span className="tnum inline-flex items-center gap-1">
              <Phone className="size-3" />
              {cliente.telefono}
            </span>
          )}
          {cliente.email && <span className="truncate">{cliente.email}</span>}
        </p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={alCambiar} className="shrink-0 gap-1">
        <X className="size-3.5" />
        Cambiar
      </Button>
    </div>
  );
}
