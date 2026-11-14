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
import { PARAMETRO_ESPESOR } from "@/lib/cad/acomodo";
import { MAX_REFERENCIAS, type ReferenciaCara } from "@/lib/cad/caras";
import { tinteDeColor, type TinteAcrilico } from "@/lib/cad/colores";
import { conEspesor } from "@/lib/cad/espesores";
import {
  acomodoParaGuardar,
  colorDeMaterial,
  nodosDe,
  planchasDelDiseno,
  type CopiaResuelta,
  type MaterialRef,
  type MaterialesPorCopia,
  type PlanchasDeGrupo,
} from "@/lib/cad/materiales";
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
  /** El visor está en modo "seleccionar caras": cada clic señala una cara. */
  modoCaras: boolean;
  setModoCaras: (activo: boolean) => void;
  /**
   * Las caras señaladas en el visor para el próximo mensaje del chat. Se
   * vacían al enviar y cuando cambia la geometría.
   */
  carasReferidas: ReferenciaCara[];
  /**
   * La copia de pieza elegida en el visor para cambiarle espesor o material
   * (su nombre de nodo, `lateral_2`). Se suelta si deja de existir.
   */
  copiaActiva: string | null;
  setCopiaActiva: (nodo: string | null) => void;
  /**
   * Cambia el espesor de esas copias (`null`: vuelven al del diseño). Regenera
   * y guarda una versión. No se ofrece en diseños libres.
   */
  cambiarEspesor: (nodos: readonly string[], mm: number | null) => Promise<void>;
  /**
   * Cambia el material de esas copias (`null`: vuelven al del diseño). No
   * regenera: recalcula las planchas y guarda una versión.
   */
  cambiarMaterial: (nodos: readonly string[], material: MaterialRef | null) => Promise<void>;
  /** El material propio de cada copia, por nodo. */
  materialesPorCopia: MaterialesPorCopia;
  /** Cada copia con su espesor, su material y su plancha. */
  copias: CopiaResuelta[];
  /** Agrega la cara o, si ya estaba, la quita. */
  alternarCara: (cara: ReferenciaCara) => void;
  quitarCara: (clave: string) => void;
  /** Reemplaza todas (para vaciarlas o devolverlas si el turno falló). */
  setCarasReferidas: (caras: ReferenciaCara[]) => void;
  /**
   * Genera el diseño y lo deja como vigente. Guarda una versión nueva salvo con
   * `guardar: false`, que es lo que usa el chat: su ruta ya la guardó.
   */
  aplicar: (
    plantilla: string,
    parametros: ParametrosCad,
    opciones?: { guardar?: boolean },
  ) => Promise<void>;

  /**
   * Espera a que termine de guardarse la última versión pedida desde aquí (el
   * formulario, el material o el espesor de una copia). Antes de usar la versión
   * vigente fuera del diseño (el producto terminado de un pedido).
   */
  esperarGuardado: () => Promise<void>;

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
  /**
   * Muestra un material (y, si vienen, los de cada copia) que otro (el chat) ya
   * guardó con la versión. No guarda nada.
   */
  mostrarMaterial: (material: MaterialDiseno | null, materiales?: MaterialesPorCopia) => void;
  /**
   * Los grupos de plancha del diseño (material × espesor), cada uno acomodado
   * en su mejor formato. Lo normal es uno; vacío sin material o sin diseño.
   */
  gruposPlanchas: PlanchasDeGrupo[];
  /** Lo que impide cortar el diseño en los materiales elegidos. Vacío: todo bien. */
  problemasMaterial: string[];
  /** El color del acrílico para el visor. `null`: cristal. */
  tinte: TinteAcrilico | null;
  /** El color de cada copia con material propio, por nodo. */
  tintes: Record<string, TinteAcrilico>;

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

/** Los grupos de plancha y sus problemas: lo usan la pantalla y el guardado. */
function calcularPlanchas(
  catalogo: GrupoPlancha[],
  material: MaterialDiseno | null,
  porCopia: MaterialesPorCopia,
  parametros: ParametrosCad,
  piezas: PiezaCad[] | undefined,
  corte: { kerfMm: number; margenMm: number },
) {
  return planchasDelDiseno({ catalogo, porDefecto: material, porCopia, parametros, piezas, corte });
}

/** Solo los materiales de copias que siguen existiendo en el despiece. */
function podar(porCopia: MaterialesPorCopia, piezas: PiezaCad[] | undefined): MaterialesPorCopia {
  if (!piezas) return porCopia;
  const nodos = new Set(piezas.flatMap(nodosDe));
  return Object.fromEntries(Object.entries(porCopia).filter(([nodo]) => nodos.has(nodo)));
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
  inicial: {
    plantilla: string | null;
    parametros: ParametrosCad;
    material?: MaterialDiseno | null;
    materiales?: MaterialesPorCopia;
  };
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
  const [modoCaras, setModoCaras] = useState(false);
  const [carasReferidas, setCarasReferidas] = useState<ReferenciaCara[]>([]);
  const alternarCara = useCallback((cara: ReferenciaCara) => {
    setCarasReferidas((actuales) => {
      if (actuales.some((c) => c.clave === cara.clave)) return actuales.filter((c) => c.clave !== cara.clave);
      if (actuales.length >= MAX_REFERENCIAS) {
        toast.info(`Puedes señalar hasta ${MAX_REFERENCIAS} caras por mensaje.`);
        return actuales;
      }
      return [...actuales, cara];
    });
  }, []);
  const quitarCara = useCallback(
    (clave: string) => setCarasReferidas((actuales) => actuales.filter((c) => c.clave !== clave)),
    [],
  );
  const [material, setMaterial] = useState<MaterialDiseno | null>(inicial.material ?? null);
  // `aplicar` guarda con el material vigente sin depender de él (no se recrea).
  const materialRef = useRef(material);
  const [porCopia, setPorCopia] = useState<MaterialesPorCopia>(inicial.materiales ?? {});
  const porCopiaRef = useRef(porCopia);
  const [copiaActiva, setCopiaActiva] = useState<string | null>(null);
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
  /** El último guardado en marcha: `esperarGuardado` lo espera. */
  const guardado = useRef<Promise<unknown>>(Promise.resolve());
  const esperarGuardado = useCallback(async () => {
    await guardado.current.catch(() => {});
  }, []);
  /** Lo deja como el guardado en marcha y lo devuelve. */
  const registrar = useCallback(<T,>(promesa: Promise<T>): Promise<T> => {
    guardado.current = promesa;
    return promesa;
  }, []);
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
      // La copia elegida sigue elegida mientras exista (cambiarle el espesor la regenera).
      const nodos = new Set(generado.piezas.flatMap(nodosDe));
      setCopiaActiva((actual) => (actual && nodos.has(actual) ? actual : null));
      // La geometría cambió: las caras señaladas ya no son las mismas.
      setCarasReferidas([]);
      setCargando(false);

      // Las versiones libres las guarda el chat; aquí solo se muestran.
      if (opciones?.guardar === false || generado.plantilla === PLANTILLA_LIBRE) return;
      try {
        // Se guarda lo que devolvió el motor, ya normalizado, no lo que se escribió.
        const elegido = materialRef.current;
        const materiales = podar(porCopiaRef.current, generado.piezas);
        const { catalogo: cat, corte: c } = contexto.current;
        const { grupos } = calcularPlanchas(cat, elegido, materiales, generado.parametros, generado.piezas, c);
        await registrar(
          guardarVersion(
            disenoId,
            generado.plantilla,
            generado.parametros,
            elegido,
            acomodoParaGuardar(grupos, c.kerfMm) as unknown as Record<string, unknown> | null,
            materiales,
          ),
        );
      } catch {
        toast.error("El diseño se generó, pero no se pudo guardar esta versión.");
      }
    },
    [disenoId, registrar],
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
        const materiales = porCopiaRef.current;
        const { grupos } = calcularPlanchas(catalogo, nuevo, materiales, parametros, resultado?.piezas, corte);
        try {
          const libre = await registrar(
            guardarMaterialDisenoLibre(
              disenoId,
              nuevo,
              acomodoParaGuardar(grupos, corte.kerfMm) as unknown as Record<string, unknown> | null,
              materiales,
            ),
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
    [aplicar, catalogo, corte, disenoId, parametros, plantilla, plantillas, registrar, resultado],
  );

  const mostrarMaterial = useCallback<EstadoDiseno["mostrarMaterial"]>((nuevo, materiales) => {
    if (nuevo) {
      materialRef.current = nuevo;
      setMaterial(nuevo);
    }
    if (materiales) {
      porCopiaRef.current = materiales;
      setPorCopia(materiales);
    }
  }, []);

  const cambiarEspesor = useCallback<EstadoDiseno["cambiarEspesor"]>(
    async (nodos, mm) => {
      if (plantilla === null || plantilla === PLANTILLA_LIBRE || nodos.length === 0) return;
      await aplicar(plantilla, conEspesor(parametros, nodos, mm));
    },
    [aplicar, parametros, plantilla],
  );

  const cambiarMaterial = useCallback<EstadoDiseno["cambiarMaterial"]>(
    async (nodos, ref) => {
      if (plantilla === null || nodos.length === 0) return;
      const anterior = porCopiaRef.current;
      const siguiente: MaterialesPorCopia = { ...anterior };
      for (const nodo of nodos) {
        if (ref) siguiente[nodo] = ref;
        else delete siguiente[nodo];
      }
      const materiales = podar(siguiente, resultado?.piezas);
      porCopiaRef.current = materiales;
      setPorCopia(materiales);

      const { grupos } = calcularPlanchas(catalogo, materialRef.current, materiales, parametros, resultado?.piezas, corte);
      const acomodo = acomodoParaGuardar(grupos, corte.kerfMm) as unknown as Record<string, unknown> | null;
      try {
        if (plantilla === PLANTILLA_LIBRE) {
          const libre = await registrar(guardarMaterialDisenoLibre(disenoId, materialRef.current, acomodo, materiales));
          if (libre) {
            setResultado((r) =>
              r && r.plantilla === PLANTILLA_LIBRE ? ({ ...r, libre } as ResultadoGeneracion & { libre: VersionLibreCad }) : r,
            );
          }
        } else {
          // El mismo diseño con otro material: no hace falta regenerar.
          await registrar(guardarVersion(disenoId, plantilla, parametros, materialRef.current, acomodo, materiales));
        }
      } catch (e) {
        porCopiaRef.current = anterior;
        setPorCopia(anterior);
        toast.error(e instanceof Error ? e.message : "No se pudo guardar el material.");
      }
    },
    [catalogo, corte, disenoId, parametros, plantilla, registrar, resultado],
  );

  const grupo = useMemo(
    () => (material ? (catalogo.find((g) => g.id === material.grupoPlanchaId) ?? null) : null),
    [catalogo, material],
  );
  const planchas = useMemo(
    () => calcularPlanchas(catalogo, material, porCopia, parametros, resultado?.piezas, corte),
    [catalogo, material, porCopia, parametros, resultado, corte],
  );
  const tinte = useMemo(
    () => (grupo ? tinteDeColor(material?.color ?? colorDe(grupo)) : null),
    [grupo, material],
  );
  const tintes = useMemo(() => {
    const salida: Record<string, TinteAcrilico> = {};
    for (const [nodo, ref] of Object.entries(porCopia)) {
      const t = tinteDeColor(colorDeMaterial(ref));
      if (t) salida[nodo] = t;
    }
    return salida;
  }, [porCopia]);

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
      modoCaras,
      setModoCaras,
      copiaActiva,
      setCopiaActiva,
      cambiarEspesor,
      cambiarMaterial,
      materialesPorCopia: porCopia,
      copias: planchas.copias,
      carasReferidas,
      alternarCara,
      quitarCara,
      setCarasReferidas,
      aplicar,
      esperarGuardado,
      catalogo,
      corte,
      material,
      grupo,
      elegirMaterial,
      mostrarMaterial,
      gruposPlanchas: planchas.grupos,
      problemasMaterial: planchas.problemas,
      tinte,
      tintes,
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
      modoCaras,
      copiaActiva,
      cambiarEspesor,
      cambiarMaterial,
      porCopia,
      carasReferidas,
      alternarCara,
      quitarCara,
      aplicar,
      esperarGuardado,
      catalogo,
      corte,
      material,
      grupo,
      elegirMaterial,
      mostrarMaterial,
      planchas,
      tinte,
      tintes,
      costos,
    ],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
