"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { guardarVersion } from "@/app/(app)/disenos/acciones";
import type { ParametrosCad, PlantillaCad, ResultadoGeneracion } from "@/lib/cad/tipos";

/**
 * El diseño que se está trabajando: el punto de encuentro del chat (izquierda)
 * y del panel (derecha). Los dos escriben por la misma puerta, `aplicar`, y
 * leen el mismo `resultado`: así un cambio que hace el asistente mueve el
 * formulario, y uno que se hace a mano lo ve el asistente en su siguiente turno.
 */
export interface EstadoDiseno {
  disenoId: string;
  plantillas: PlantillaCad[];
  plantilla: string | null;
  parametros: ParametrosCad;
  /** Lo último que generó el motor. `null` hasta la primera generación. */
  resultado: ResultadoGeneracion | null;
  cargando: boolean;
  error: string | null;
  /** Los errores por parámetro del último 422 del motor, por clave. */
  erroresCampo: Record<string, string>;
  /** La pieza resaltada: la comparten el visor y la lista de piezas. */
  piezaActiva: string | null;
  setPiezaActiva: (id: string | null) => void;
  /**
   * Genera el diseño y lo deja como vigente. Guarda una versión nueva salvo con
   * `guardar: false`, que es lo que usa el chat: su ruta ya la guardó.
   */
  aplicar: (
    plantilla: string,
    parametros: ParametrosCad,
    opciones?: { guardar?: boolean },
  ) => Promise<void>;
}

const Contexto = createContext<EstadoDiseno | null>(null);

export function useDiseno(): EstadoDiseno {
  const valor = useContext(Contexto);
  if (!valor) throw new Error("useDiseno() va dentro de <DisenoProvider>.");
  return valor;
}

interface CuerpoError {
  error?: string;
  errores?: { campo: string; mensaje: string }[];
}

export function DisenoProvider({
  disenoId,
  plantillas,
  inicial,
  children,
}: {
  disenoId: string;
  plantillas: PlantillaCad[];
  inicial: { plantilla: string | null; parametros: ParametrosCad };
  children: ReactNode;
}) {
  const [plantilla, setPlantilla] = useState(inicial.plantilla);
  const [parametros, setParametros] = useState(inicial.parametros);
  const [resultado, setResultado] = useState<ResultadoGeneracion | null>(null);
  // Con plantilla guardada se genera nada más montar: arrancar ya "cargando"
  // evita un parpadeo del estado vacío antes de ese primer efecto.
  const [cargando, setCargando] = useState(inicial.plantilla !== null);
  const [error, setError] = useState<string | null>(null);
  const [erroresCampo, setErroresCampo] = useState<Record<string, string>>({});
  const [piezaActiva, setPiezaActiva] = useState<string | null>(null);

  /**
   * El turno de la última llamada. El formulario dispara una generación por cada
   * pausa al escribir y el motor no tarda siempre lo mismo: sin esto, la
   * respuesta de "120" podría llegar después que la de "1200" y pisarla.
   */
  const turno = useRef(0);
  const enCurso = useRef<AbortController | null>(null);

  const aplicar = useCallback<EstadoDiseno["aplicar"]>(
    async (nuevaPlantilla, nuevosParametros, opciones) => {
      const mio = ++turno.current;
      const vigente = () => mio === turno.current;
      enCurso.current?.abort();
      const control = new AbortController();
      enCurso.current = control;

      // Lo pedido queda como vigente desde ya: el formulario y el chat no esperan
      // al motor para mostrar lo que se acaba de elegir.
      setPlantilla(nuevaPlantilla);
      setParametros(nuevosParametros);
      setCargando(true);
      setError(null);
      setErroresCampo({});

      let generado: ResultadoGeneracion;
      try {
        const res = await fetch("/api/cad/generar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plantilla: nuevaPlantilla, parametros: nuevosParametros }),
          signal: control.signal,
        });
        if (!vigente()) return;

        if (!res.ok) {
          const cuerpo = (await res.json().catch(() => ({}))) as CuerpoError;
          if (!vigente()) return;
          setError(cuerpo.error ?? "No se pudo generar el diseño. Intenta de nuevo.");
          setErroresCampo(
            Object.fromEntries((cuerpo.errores ?? []).map((e) => [e.campo, e.mensaje])),
          );
          setCargando(false);
          return;
        }

        generado = (await res.json()) as ResultadoGeneracion;
        if (!vigente()) return;
      } catch {
        // Un `abort` es una llamada nueva que ya tomó el relevo: no es un error.
        if (!vigente()) return;
        setError("No se pudo conectar con el servidor. Revisa tu conexión.");
        setCargando(false);
        return;
      }

      setResultado(generado);
      setPlantilla(generado.plantilla);
      setParametros(generado.parametros);
      setPiezaActiva(null);
      setCargando(false);

      if (opciones?.guardar === false) return;
      try {
        // Se guarda lo que devolvió el motor, ya normalizado, no lo que se escribió.
        await guardarVersion(disenoId, generado.plantilla, generado.parametros);
      } catch {
        toast.error("El diseño se generó, pero no se pudo guardar esta versión.");
      }
    },
    [disenoId],
  );

  // El diseño guardado se regenera al abrir: el GLB no se persiste, solo los
  // parámetros. Sin `guardar`, porque abrir un diseño no es una versión nueva.
  const arranque = useRef(inicial);
  useEffect(() => {
    const { plantilla: p, parametros: ps } = arranque.current;
    if (p !== null) void aplicar(p, ps, { guardar: false });
    return () => {
      // Al desmontar, la respuesta que llegue ya no es de nadie.
      turno.current++;
      enCurso.current?.abort();
    };
  }, [aplicar]);

  const valor = useMemo<EstadoDiseno>(
    () => ({
      disenoId,
      plantillas,
      plantilla,
      parametros,
      resultado,
      cargando,
      error,
      erroresCampo,
      piezaActiva,
      setPiezaActiva,
      aplicar,
    }),
    [
      disenoId,
      plantillas,
      plantilla,
      parametros,
      resultado,
      cargando,
      error,
      erroresCampo,
      piezaActiva,
      aplicar,
    ],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
