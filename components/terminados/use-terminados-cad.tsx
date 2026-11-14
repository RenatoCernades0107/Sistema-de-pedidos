"use client";

import { useState } from "react";
import { toast } from "sonner";
import { abrirDiseno, crearDiseno } from "@/app/(app)/disenos/acciones";
import { esTerminado, ponerTerminado, type Linea } from "@/lib/lineas-cotizacion";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import type { CatalogoTerminados } from "@/lib/terminados/catalogo";
import { DisenadorTerminado, type DatosDiseno } from "./disenador-terminado";
import { EditorTerminado } from "./editor-terminado";

/**
 * Los productos terminados de un formulario (nuevo pedido, nueva cotización):
 * uno nuevo se diseña con el motor CAD, a pantalla completa como en `/disenos`,
 * y la línea queda enlazada al diseño para volver a abrirlo al editarla. Una
 * línea sin diseño (de antes del CAD) se edita en el formulario de siempre.
 *
 * `alPoner` recibe las líneas con el terminado ya puesto y la clave de su línea:
 * el formulario las guarda, la resalta y lleva el foco a donde siga.
 */
export function useTerminadosCad({
  lineas,
  alPoner,
  catalogo,
  config,
  terminados,
  diseno,
  cliente,
  enlazadas = {},
}: {
  lineas: Linea[];
  alPoner: (siguientes: Linea[], clave: string) => void;
  catalogo: GrupoPlancha[];
  config: ConfigCortes;
  terminados: CatalogoTerminados;
  diseno: DatosDiseno;
  cliente?: string | null;
  /** Líneas que ya llegan con su diseño (p. ej. desde `/disenos`): clave → id del diseño. */
  enlazadas?: Record<string, string>;
}) {
  /** Un terminado sin diseño: se edita en el formulario de siempre. */
  const [terminado, setTerminado] = useState<{ clave: string | null } | null>(null);
  /** El producto terminado que se está diseñando, a pantalla completa. */
  const [disenando, setDisenando] = useState<{
    disenoId: string;
    nuevo: boolean;
    inicial: Awaited<ReturnType<typeof abrirDiseno>> | null;
    clave: string | null;
  } | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  /** El diseño de cada línea de terminado, por su clave: para volver a abrirlo al editar. */
  const [disenosDeLinea, setDisenosDeLinea] = useState<Record<string, string>>(enlazadas);

  const nuevo = async () => {
    if (abriendo) return;
    setAbriendo(true);
    try {
      const { id } = await crearDiseno();
      setDisenando({ disenoId: id, nuevo: true, inicial: null, clave: null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo empezar el diseño.");
    } finally {
      setAbriendo(false);
    }
  };

  const editar = async (clave: string) => {
    const disenoId = disenosDeLinea[clave];
    if (!disenoId) return setTerminado({ clave });
    if (abriendo) return;
    setAbriendo(true);
    try {
      setDisenando({ disenoId, nuevo: false, inicial: await abrirDiseno(disenoId), clave });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo abrir el diseño.");
    } finally {
      setAbriendo(false);
    }
  };

  const editores = (
    <>
      {disenando && (
        <DisenadorTerminado
          key={disenando.disenoId}
          disenoId={disenando.disenoId}
          nuevo={disenando.nuevo}
          inicial={disenando.inicial}
          datos={diseno}
          catalogo={catalogo}
          terminados={terminados}
          linea={lineas.filter(esTerminado).find((l) => l.clave === disenando.clave) ?? null}
          cliente={cliente}
          alCerrar={() => setDisenando(null)}
          alAgregar={(t) => {
            const { lineas: siguientes, clave } = ponerTerminado(lineas, t);
            const { disenoId } = disenando;
            setDisenosDeLinea((d) => ({ ...d, [clave]: disenoId }));
            setDisenando(null);
            alPoner(siguientes, clave);
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
          alGuardar={(t) => {
            const { lineas: siguientes, clave } = ponerTerminado(lineas, t);
            setTerminado(null);
            alPoner(siguientes, clave);
          }}
        />
      )}
    </>
  );

  return { nuevo, editar, abriendo, editores };
}
