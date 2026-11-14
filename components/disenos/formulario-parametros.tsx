"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Slider } from "@base-ui/react/slider";
import { Switch } from "@base-ui/react/switch";
import { RotateCcw } from "lucide-react";
import {
  camposDe,
  medida,
  normalizarValor,
  pasoDe,
  unidadDe,
  valoresPorDefecto,
  type CampoEsquema,
} from "@/lib/cad/esquema";
import { conservarEspesores } from "@/lib/cad/espesores";
import type { ParametrosCad, PlantillaCad, ValorParametro } from "@/lib/cad/tipos";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDiseno } from "./diseno-contexto";

/** Lo que hay escrito en el formulario: los números como texto, tal cual se teclean. */
type Borrador = Record<string, string | boolean>;

/** Lo que se espera a que la persona deje de escribir antes de regenerar. */
const ESPERA_MS = 400;

function aBorrador(campos: CampoEsquema[], parametros: ParametrosCad): Borrador {
  const b: Borrador = {};
  for (const c of campos) {
    const v = parametros[c.clave] ?? c.propiedad.default;
    if (c.control === "interruptor") b[c.clave] = v === true;
    else b[c.clave] = v === undefined ? "" : typeof v === "number" ? medida(v) : String(v);
  }
  return b;
}

/** El valor de un campo y, si no se puede mandar al motor, por qué. */
function leer(c: CampoEsquema, crudo: string | boolean): { valor?: ValorParametro; error?: string } {
  const valor = normalizarValor(c.propiedad, crudo);
  if (c.control === "numero" || c.control === "entero") {
    if (valor === undefined) return { error: "Escribe un número." };
    const unidad = unidadDe(c.propiedad);
    const con = (n: number) => (unidad ? `${medida(n)} ${unidad}` : medida(n));
    if (c.minimo !== undefined && (valor as number) < c.minimo) return { error: `El mínimo es ${con(c.minimo)}.` };
    if (c.maximo !== undefined && (valor as number) > c.maximo) return { error: `El máximo es ${con(c.maximo)}.` };
  }
  if (valor === undefined) return { error: "Elige una opción." };
  return { valor };
}

/**
 * El formulario de parámetros, generado del esquema de la plantilla
 * (`PlantillaCad.esquema`): no hay un formulario escrito por plantilla, así que
 * una plantilla nueva en el motor aparece aquí sin tocar la app.
 *
 * No usa react-hook-form como los demás formularios porque no hay envío: cada
 * cambio regenera el diseño tras una pausa, y la validación de verdad la hace
 * el motor, que devuelve sus errores por campo.
 */
export function FormularioParametros({ plantilla }: { plantilla: PlantillaCad }) {
  const { parametros, aplicar, erroresCampo } = useDiseno();
  const campos = useMemo(() => camposDe(plantilla.esquema), [plantilla.esquema]);
  // El envío sale de un temporizador: lee los parámetros vigentes, no los de cuando se tecleó.
  const vigentes = useRef(parametros);
  useEffect(() => {
    vigentes.current = parametros;
  }, [parametros]);

  const [borrador, setBorrador] = useState<Borrador>(() => aBorrador(campos, parametros));
  /** Hay un cambio escrito que todavía no se ha mandado al motor. */
  const [pendiente, setPendiente] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Los parámetros cambian desde fuera cuando el asistente modifica el diseño o
  // cuando el motor devuelve los suyos ya normalizados. Se copian al formulario,
  // pero nunca sobre algo que se está escribiendo: con un cambio pendiente manda
  // el teclado, y un campo cuyo texto ya vale lo mismo ("120," y 120) no se toca.
  const [vistos, setVistos] = useState(parametros);
  if (vistos !== parametros) {
    setVistos(parametros);
    if (!pendiente) {
      const nuevo = aBorrador(campos, parametros);
      let cambia = false;
      const mezcla: Borrador = { ...borrador };
      for (const c of campos) {
        if (normalizarValor(c.propiedad, borrador[c.clave]) === parametros[c.clave]) continue;
        mezcla[c.clave] = nuevo[c.clave];
        cambia = true;
      }
      if (cambia) setBorrador(mezcla);
    }
  }

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  const erroresLocales = useMemo(() => {
    const e: Record<string, string> = {};
    for (const c of campos) {
      const { error } = leer(c, borrador[c.clave]);
      if (error) e[c.clave] = error;
    }
    return e;
  }, [campos, borrador]);

  function enviar(b: Borrador) {
    const valores: ParametrosCad = {};
    for (const c of campos) {
      const { valor, error } = leer(c, b[c.clave]);
      // Con un campo a medias no se regenera: el error ya está pintado bajo él.
      if (error || valor === undefined) return;
      valores[c.clave] = valor;
    }
    // Los espesores elegidos copia por copia no están en el formulario: se conservan.
    void aplicar(plantilla.codigo, conservarEspesores(valores, vigentes.current));
  }

  function cambiar(clave: string, valor: string | boolean, inmediato = false) {
    const siguiente = { ...borrador, [clave]: valor };
    setBorrador(siguiente);
    setPendiente(true);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(
      () => {
        temporizador.current = null;
        setPendiente(false);
        enviar(siguiente);
      },
      inmediato ? 0 : ESPERA_MS,
    );
  }

  function restablecer() {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = null;
    const porDefecto = valoresPorDefecto(plantilla.esquema);
    setBorrador(aBorrador(campos, porDefecto));
    setPendiente(false);
    void aplicar(plantilla.codigo, porDefecto);
  }

  if (campos.length === 0) {
    return <p className="text-muted-foreground text-sm">Esta plantilla no tiene parámetros que ajustar.</p>;
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()} noValidate>
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        {campos.map((c) => (
          <CampoParametro
            key={c.clave}
            campo={c}
            valor={borrador[c.clave]}
            error={erroresLocales[c.clave] ?? erroresCampo[c.clave]}
            alCambiar={(v, inmediato) => cambiar(c.clave, v, inmediato)}
          />
        ))}
      </div>
      <div>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground gap-1.5" onClick={restablecer}>
          <RotateCcw />
          Restablecer valores y espesores
        </Button>
      </div>
    </form>
  );
}

function CampoParametro({
  campo,
  valor,
  error,
  alCambiar,
}: {
  campo: CampoEsquema;
  valor: string | boolean;
  error?: string;
  alCambiar: (valor: string | boolean, inmediato?: boolean) => void;
}) {
  const { etiqueta, ayuda, control, requerido } = campo;

  if (control === "interruptor") {
    return (
      <Campo label={etiqueta} ayuda={ayuda} error={error} requerido={requerido}>
        <Switch.Root
          checked={valor === true}
          onCheckedChange={(v) => alCambiar(v, true)}
          className="bg-input data-checked:bg-primary focus-visible:ring-ring/50 relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-3"
        >
          <Switch.Thumb className="bg-background block size-4 translate-x-0.5 rounded-full shadow-sm transition-transform data-checked:translate-x-[1.125rem]" />
        </Switch.Root>
      </Campo>
    );
  }

  if (control === "lista") {
    return (
      <Campo label={etiqueta} ayuda={ayuda} error={error} requerido={requerido}>
        <Select value={String(valor)} onValueChange={(v) => v && alCambiar(v, true)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {campo.opciones.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>
    );
  }

  if (control === "texto") {
    return (
      <Campo label={etiqueta} ayuda={ayuda} error={error} requerido={requerido}>
        <Input value={String(valor)} onChange={(e) => alCambiar(e.target.value)} maxLength={200} />
      </Campo>
    );
  }

  const unidad = unidadDe(campo.propiedad);
  const { minimo, maximo } = campo;
  const conDeslizador = minimo !== undefined && maximo !== undefined && maximo > minimo;
  const numero = normalizarValor(campo.propiedad, valor);
  const rango =
    minimo !== undefined && maximo !== undefined
      ? `De ${medida(minimo)} a ${medida(maximo)}${unidad ? ` ${unidad}` : ""}.`
      : undefined;

  return (
    <Campo
      label={etiqueta}
      ayuda={[ayuda, rango].filter(Boolean).join(" ") || undefined}
      error={error}
      requerido={requerido}
    >
      <InputGroup>
        <InputGroupInput
          inputMode={control === "entero" ? "numeric" : "decimal"}
          autoComplete="off"
          value={String(valor)}
          onChange={(e) => alCambiar(e.target.value)}
          className="tabular-nums"
        />
        {unidad && (
          <InputGroupAddon align="inline-end">
            <InputGroupText>{unidad}</InputGroupText>
          </InputGroupAddon>
        )}
      </InputGroup>
      {conDeslizador && (
        <Slider.Root
          value={typeof numero === "number" ? Math.min(maximo, Math.max(minimo, numero)) : minimo}
          onValueChange={(v) => alCambiar(medida(v))}
          min={minimo}
          max={maximo}
          step={pasoDe(campo.propiedad)}
          // La etiqueta del campo ya nombra a la caja de texto; el deslizador es
          // el mismo dato por otra vía y se nombra aparte.
          aria-label={`${etiqueta} (deslizador)`}
        >
          <Slider.Control className="flex h-4 w-full touch-none items-center select-none">
            <Slider.Track className="bg-muted relative h-1 w-full rounded-full">
              <Slider.Indicator className="bg-primary/70 rounded-full" />
              <Slider.Thumb className="bg-background border-primary focus-visible:ring-ring/50 size-3.5 rounded-full border-2 shadow-sm outline-none focus-visible:ring-3" />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
      )}
    </Campo>
  );
}
