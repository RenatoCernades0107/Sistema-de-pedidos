"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { abrirDiseno, crearDiseno } from "@/app/(app)/disenos/acciones";
import { esTerminado, ponerTerminado, type Linea } from "@/lib/lineas-cotizacion";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import type { CatalogoTerminados } from "@/lib/terminados/catalogo";
import type { BorradorDiseno, BorradorTerminado } from "@/lib/borradores-editores";
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
 *
 * `enCurso` es el editor abierto a medias, para el borrador del formulario; con
 * `retomar` (lo que quedó en el borrador) el editor vuelve a abrirse así.
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
  retomar = null,
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
  /** El editor que quedó abierto a medias en el borrador que se retoma. */
  retomar?: BorradorTerminado | BorradorDiseno | null;
}) {
  /** Un terminado sin diseño: se edita en el formulario de siempre. */
  const [terminado, setTerminado] = useState<{ clave: string | null; borrador?: BorradorTerminado } | null>(() =>
    retomar?.tipo === "terminado" ? { clave: retomar.clave, borrador: retomar } : null,
  );
  /** El producto terminado que se está diseñando, a pantalla completa. */
  const [disenando, setDisenando] = useState<{
    disenoId: string;
    nuevo: boolean;
    inicial: Awaited<ReturnType<typeof abrirDiseno>> | null;
    clave: string | null;
    retomado?: BorradorDiseno;
  } | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  /** Lo que lleva armado el editor abierto; `null` si no hay nada que perder. */
  const [enCurso, setEnCurso] = useState<BorradorTerminado | BorradorDiseno | null>(retomar);

  // Un diseño que quedó a medias: se vuelve a abrir (el diseño ya está guardado en `disenos`).
  const porRetomar = useRef(retomar?.tipo === "diseno" ? retomar : null);
  useEffect(() => {
    const r = porRetomar.current;
    if (!r) return;
    porRetomar.current = null;
    abrirDiseno(r.disenoId)
      .then((inicial) => setDisenando({ disenoId: r.disenoId, nuevo: r.nuevo, inicial, clave: r.clave, retomado: r }))
      .catch(() => {
        toast.error("No se pudo volver a abrir el producto terminado que quedó a medias.");
        setEnCurso(null);
      });
  }, []);

  const cerrarTerminado = () => {
    setTerminado(null);
    setEnCurso(null);
  };
  const cerrarDiseno = () => {
    setDisenando(null);
    setEnCurso(null);
  };
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
          retomado={disenando.retomado}
          alCambiarBorrador={setEnCurso}
          alCerrar={cerrarDiseno}
          alAgregar={(t) => {
            const { lineas: siguientes, clave } = ponerTerminado(lineas, t);
            const { disenoId } = disenando;
            setDisenosDeLinea((d) => ({ ...d, [clave]: disenoId }));
            cerrarDiseno();
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
          borrador={terminado.borrador}
          alCambiarBorrador={setEnCurso}
          alCerrar={cerrarTerminado}
          alGuardar={(t) => {
            const { lineas: siguientes, clave } = ponerTerminado(lineas, t);
            cerrarTerminado();
            alPoner(siguientes, clave);
          }}
        />
      )}
    </>
  );

  return { nuevo, editar, abriendo, editores, disenosDeLinea, enCurso };
}
