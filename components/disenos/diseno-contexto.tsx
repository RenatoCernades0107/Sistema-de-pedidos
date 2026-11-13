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
import { guardarMaterialDisenoLibre, guardarVersion } from "@/app/(app)/disenos/acciones";
import {
  acomodar,
  formatosDeGrupo,
  PARAMETRO_ESPESOR,
  piezasQueNoEntran,
  problemaDeEspesor,
  type ResultadoAcomodo,
} from "@/lib/cad/acomodo";
import { tinteDeColor, type TinteAcrilico } from "@/lib/cad/colores";
import { colorDe, type GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import type {
  MaterialDiseno,
  ParametrosCad,
  PiezaCad,
  PlantillaCad,
  ResultadoGeneracion,
  VersionLibreCad,
} from "@/lib/cad/tipos";
import { PLANTILLA_LIBRE } from "@/lib/cad/tipos";

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

  /* ── Planchas ── */
  /** Los grupos del catálogo con algún formato activo. Vacío si no se pudo leer. */
  catalogo: GrupoPlancha[];
  /** El kerf del láser y el borde que no se aprovecha, en mm (de la configuración de cortes). */
  corte: { kerfMm: number; margenMm: number };
  material: MaterialDiseno | null;
  /** El grupo del material elegido, si sigue en el catálogo. */
  grupo: GrupoPlancha | null;
  /**
   * Elige el material. Si la plantilla tiene `espesor`, lo pone al de la plancha
   * y regenera; siempre guarda una versión nueva con el material. En un diseño
   * libre no se regenera (el espesor lo fija el código): se guarda el mismo
   * código con el material y el acomodo de sus piezas.
   */
  elegirMaterial: (material: MaterialDiseno) => Promise<void>;
  /** Muestra un material que otro (el chat) ya guardó con la versión. No guarda nada. */
  mostrarMaterial: (material: MaterialDiseno) => void;
  /** Las piezas acomodadas en el mejor formato del grupo. `null` sin material o sin diseño. */
  acomodo: ResultadoAcomodo | null;
  /** Lo que impide cortar el diseño en el material elegido. Vacío: todo bien. */
  problemasMaterial: string[];
  /** El color del acrílico para el visor. `null`: cristal. */
  tinte: TinteAcrilico | null;

  /* ── Costo ── */
  /**
   * Para calcular lo que cuesta: la configuración de cortes y el precio de Odoo
   * de cada plancha, por código. Solo llega a Administración; `null` para los demás.
   */
  costos: CostosDiseno | null;
}

export interface CostosDiseno {
  config: ConfigCortes;
  precios: Record<string, number>;
}

/** Acomodo y problemas de un despiece en un grupo: lo usan la pantalla y el guardado. */
function calcularPlanchas(
  grupo: GrupoPlancha | null,
  parametros: ParametrosCad,
  piezas: PiezaCad[] | undefined,
  corte: { kerfMm: number; margenMm: number },
): { acomodo: ResultadoAcomodo | null; problemas: string[] } {
  if (!grupo) return { acomodo: null, problemas: [] };
  const problemas: string[] = [];
  const espesor = problemaDeEspesor(parametros, piezas, grupo);
  if (espesor) problemas.push(espesor);
  if (!piezas?.length) return { acomodo: null, problemas };

  const formatos = formatosDeGrupo(grupo);
  const opciones = { rotable: grupo.rotable, kerfMm: corte.kerfMm, margenMm: corte.margenMm };
  if (formatos.length === 0) {
    problemas.push("El material elegido no tiene formatos de plancha activos.");
    return { acomodo: null, problemas };
  }
  for (const p of piezasQueNoEntran(piezas, formatos, opciones)) {
    problemas.push(
      `«${p.nombre}» (${Math.round(p.ancho_mm)} × ${Math.round(p.alto_mm)} mm) no entra en ninguna plancha de este material${grupo.rotable ? "" : " (no se puede girar)"}.`,
    );
  }
  return { acomodo: acomodar(piezas, formatos, opciones), problemas };
}

const Contexto = createContext<EstadoDiseno | null>(null);

const SIN_CATALOGO: GrupoPlancha[] = [];
const SIN_KERF = { kerfMm: 0, margenMm: 0 };

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
  catalogo = SIN_CATALOGO,
  corte = SIN_KERF,
  costos = null,
  children,
}: {
  disenoId: string;
  plantillas: PlantillaCad[];
  inicial: { plantilla: string | null; parametros: ParametrosCad; material?: MaterialDiseno | null };
  catalogo?: GrupoPlancha[];
  corte?: { kerfMm: number; margenMm: number };
  costos?: CostosDiseno | null;
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
  const [material, setMaterial] = useState<MaterialDiseno | null>(inicial.material ?? null);
  // `aplicar` guarda con el material vigente sin depender de él (no se recrea).
  const materialRef = useRef(material);
  const contexto = useRef({ catalogo, corte });
  useEffect(() => {
    contexto.current = { catalogo, corte };
  }, [catalogo, corte]);

  /**
   * El turno de la última llamada. El formulario dispara una generación por cada
   * pausa al escribir y el motor no tarda siempre lo mismo: sin esto, la
   * respuesta de "120" podría llegar después que la de "1200" y pisarla.
   */
  const turno = useRef(0);
  const enCurso = useRef<AbortController | null>(null);

  /** Deja huérfana la llamada en curso: su respuesta, si llega, se descarta. */
  const cancelar = useCallback(() => {
    turno.current++;
    enCurso.current?.abort();
  }, []);

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
        // Un diseño libre (código) no se genera desde parámetros: el servidor
        // ejecuta en el sandbox el código de la versión vigente.
        const libre = nuevaPlantilla === PLANTILLA_LIBRE;
        const res = await fetch(libre ? "/api/cad/libre" : "/api/cad/generar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(libre ? { disenoId } : { plantilla: nuevaPlantilla, parametros: nuevosParametros }),
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

      // Las versiones libres las guarda el chat; aquí solo se muestran.
      if (opciones?.guardar === false || generado.plantilla === PLANTILLA_LIBRE) return;
      try {
        // Se guarda lo que devolvió el motor, ya normalizado, no lo que se escribió.
        const elegido = materialRef.current;
        const grupo = elegido
          ? (contexto.current.catalogo.find((g) => g.id === elegido.grupoPlanchaId) ?? null)
          : null;
        const { acomodo } = calcularPlanchas(grupo, generado.parametros, generado.piezas, contexto.current.corte);
        await guardarVersion(
          disenoId,
          generado.plantilla,
          generado.parametros,
          elegido,
          acomodo ? { ...acomodo, kerfMm: contexto.current.corte.kerfMm } : null,
        );
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
    // Al desmontar, la respuesta que llegue ya no es de nadie.
    return cancelar;
  }, [aplicar, cancelar]);

  const elegirMaterial = useCallback<EstadoDiseno["elegirMaterial"]>(
    async (nuevo) => {
      const anterior = materialRef.current;
      materialRef.current = nuevo;
      setMaterial(nuevo);
      if (plantilla === null) return;
      const grupo = catalogo.find((g) => g.id === nuevo.grupoPlanchaId);

      if (plantilla === PLANTILLA_LIBRE) {
        const { acomodo } = calcularPlanchas(grupo ?? null, parametros, resultado?.piezas, corte);
        try {
          const libre = await guardarMaterialDisenoLibre(
            disenoId,
            nuevo,
            acomodo ? { ...acomodo, kerfMm: corte.kerfMm } : null,
          );
          // La versión nueva (mismo código) pasa a ser la vigente: sin volver a ejecutarlo.
          if (libre) {
            setResultado((r) =>
              r && r.plantilla === PLANTILLA_LIBRE ? ({ ...r, libre } as ResultadoGeneracion & { libre: VersionLibreCad }) : r,
            );
          }
        } catch (e) {
          materialRef.current = anterior;
          setMaterial(anterior);
          toast.error(e instanceof Error ? e.message : "No se pudo guardar el material.");
        }
        return;
      }

      const esquema = plantillas.find((p) => p.codigo === plantilla)?.esquema;
      const conEspesor = grupo && esquema?.properties[PARAMETRO_ESPESOR]?.type === "number";
      // Elegir la plancha es también elegir el espesor: se regenera con él y se guarda.
      await aplicar(
        plantilla,
        conEspesor ? { ...parametros, [PARAMETRO_ESPESOR]: grupo.espesorMm } : parametros,
      );
    },
    [aplicar, catalogo, corte, disenoId, parametros, plantilla, plantillas, resultado],
  );

  const grupo = useMemo(
    () => (material ? (catalogo.find((g) => g.id === material.grupoPlanchaId) ?? null) : null),
    [catalogo, material],
  );
  const planchas = useMemo(
    () => calcularPlanchas(grupo, parametros, resultado?.piezas, corte),
    [grupo, parametros, resultado, corte],
  );
  const tinte = useMemo(
    () => (grupo ? tinteDeColor(material?.color ?? colorDe(grupo)) : null),
    [grupo, material],
  );

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
      catalogo,
      corte,
      material,
      grupo,
      elegirMaterial,
      mostrarMaterial: setMaterial,
      acomodo: planchas.acomodo,
      problemasMaterial: planchas.problemas,
      tinte,
      costos,
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
      catalogo,
      corte,
      material,
      grupo,
      elegirMaterial,
      planchas,
      tinte,
      costos,
    ],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
