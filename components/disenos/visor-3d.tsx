"use client";

import type { TinteAcrilico } from "@/lib/cad/colores";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Edges, Grid, OrbitControls } from "@react-three/drei";
import { Slider } from "@base-ui/react/slider";
import { MousePointerClick, TriangleAlert } from "lucide-react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describirCara, segmentarCaras, type CaraMalla, type ReferenciaCara } from "@/lib/cad/caras";
import { medida, nodoAPieza } from "@/lib/cad/esquema";
import { cn } from "@/lib/utils";

/**
 * El render 3D del diseño. Recibe el GLB tal como lo manda el motor (base64) y
 * lo vuelve a armar pieza por pieza en vez de colgar la escena del glTF tal
 * cual, por tres motivos: el material lo pone la app (acrílico, no el gris que
 * exporte el motor), cada pieza tiene que poder resaltarse sola, y la vista
 * explosionada necesita mover cada una desde su centro.
 *
 * Todo se pasa a milímetros al cargar (glTF viene en metros): así la rejilla, la
 * cámara y la lectura de medidas hablan la unidad del taller.
 *
 * En modo "seleccionar caras" cada clic señala una cara plana (o un canto) de
 * una pieza para referirla en el chat: las caras se reconstruyen de los
 * triángulos con `segmentarCaras` (`lib/cad/caras.ts`).
 *
 * Se carga con `next/dynamic` y `ssr: false` desde `panel-diseno.tsx`: three
 * necesita `window` y un `<canvas>` de verdad.
 */

/** Una instancia de pieza: un nodo del GLB con sus mallas, ya en mm. */
interface Instancia {
  clave: string;
  /** El `id` de la pieza en el despiece, o `null` si el nodo no casa con ninguna. */
  pieza: string | null;
  geometrias: THREE.BufferGeometry[];
  /** Las caras de cada geometría y, por triángulo, a cuál pertenece. */
  caras: { caras: CaraMalla[]; caraDeTriangulo: Int32Array }[];
  centro: THREE.Vector3;
  /** Qué copia de su pieza es (1…de), en el orden del GLB. */
  copia: number;
  de: number;
}

interface Modelo {
  instancias: Instancia[];
  caja: THREE.Box3;
  centro: THREE.Vector3;
  /** El radio de la esfera que envuelve el conjunto: la escala de todo lo demás. */
  radio: number;
}

const A_MM = new THREE.Matrix4().makeScale(1000, 1000, 1000);

function bytesDe(base64: string): ArrayBuffer {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes.buffer;
}

/** Suelta lo que el GLTFLoader reservó en la GPU: de la escena original solo se usan copias. */
function liberar(raiz: THREE.Object3D) {
  raiz.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    const materiales: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materiales) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

/**
 * El nodo que representa a la pieza: el motor crea uno por instancia, pero una
 * pieza con varias primitivas llega como un nodo con mallas hijas. Se sube por
 * los ancestros hasta dar con un nombre que sea de una pieza.
 */
function nodoDePieza(malla: THREE.Object3D, ids: readonly string[]) {
  for (let o: THREE.Object3D | null = malla; o; o = o.parent) {
    const pieza = nodoAPieza(o.name, ids);
    if (pieza) return { nodo: o, pieza };
  }
  return { nodo: malla, pieza: null };
}

function armarModelo(escena: THREE.Object3D, ids: readonly string[]): Modelo | null {
  escena.updateMatrixWorld(true);
  const porNodo = new Map<THREE.Object3D, Instancia>();
  const caja = new THREE.Box3();

  escena.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometria = (o.geometry as THREE.BufferGeometry).clone();
    geometria.applyMatrix4(new THREE.Matrix4().multiplyMatrices(A_MM, o.matrixWorld));
    geometria.computeBoundingBox();
    geometria.computeVertexNormals();
    if (!geometria.boundingBox || geometria.boundingBox.isEmpty()) {
      geometria.dispose();
      return;
    }
    caja.union(geometria.boundingBox);

    const { nodo, pieza } = nodoDePieza(o, ids);
    const instancia = porNodo.get(nodo) ?? {
      clave: nodo.uuid,
      pieza,
      geometrias: [],
      caras: [],
      centro: new THREE.Vector3(),
      copia: 1,
      de: 1,
    };
    instancia.geometrias.push(geometria);
    porNodo.set(nodo, instancia);
  });

  if (caja.isEmpty()) return null;

  const instancias = [...porNodo.values()];
  const copias = new Map<string, number>();
  for (const i of instancias) {
    const propia = new THREE.Box3();
    for (const g of i.geometrias) propia.union(g.boundingBox!);
    propia.getCenter(i.centro);
    i.caras = i.geometrias.map((g) => segmentarCaras(g.getAttribute("position").array, g.index?.array));
    const clave = i.pieza ?? i.clave;
    i.copia = (copias.get(clave) ?? 0) + 1;
    copias.set(clave, i.copia);
  }
  for (const i of instancias) i.de = copias.get(i.pieza ?? i.clave) ?? 1;

  const esfera = caja.getBoundingSphere(new THREE.Sphere());
  return { instancias, caja, centro: esfera.center, radio: Math.max(esfera.radius, 1) };
}

/** Carga el GLB y devuelve el modelo armado. Libera las geometrías al cambiar o salir. */
function useModelo(glbBase64: string, ids: readonly string[]) {
  const [estado, setEstado] = useState<{ modelo: Modelo | null; fallo: boolean }>({
    modelo: null,
    fallo: false,
  });
  // Los ids cambian de identidad en cada render del padre; lo que importa es su contenido.
  const firma = ids.join("|");

  useEffect(() => {
    let vivo = true;
    let creado: Modelo | null = null;

    (async () => {
      try {
        const gltf = await new GLTFLoader().parseAsync(bytesDe(glbBase64), "");
        const modelo = armarModelo(gltf.scene, firma ? firma.split("|") : []);
        liberar(gltf.scene);
        if (!vivo) {
          modelo?.instancias.forEach((i) => i.geometrias.forEach((g) => g.dispose()));
          return;
        }
        creado = modelo;
        setEstado({ modelo, fallo: modelo === null });
      } catch (e) {
        console.error("[visor-3d] no se pudo leer el GLB", e);
        if (vivo) setEstado({ modelo: null, fallo: true });
      }
    })();

    return () => {
      vivo = false;
      creado?.instancias.forEach((i) => i.geometrias.forEach((g) => g.dispose()));
    };
  }, [glbBase64, firma]);

  return estado;
}

/** Los colores de la escena. three no lee variables CSS: van escritos por tema. */
const TEMAS = {
  light: {
    acrilico: "#cfe9f5",
    arista: "#2f4858",
    activo: "#f59e0b",
    aristaActiva: "#92400e",
    celda: "#d4d4d8",
    seccion: "#a1a1aa",
    ambiente: 1.1,
    opacidad: 0.38,
  },
  dark: {
    acrilico: "#9fd6ee",
    arista: "#d6eef8",
    activo: "#fbbf24",
    aristaActiva: "#fde68a",
    celda: "#3f3f46",
    seccion: "#71717a",
    ambiente: 0.7,
    opacidad: 0.38,
  },
} as const;

type Tema = {
  [K in keyof (typeof TEMAS)["light"]]: (typeof TEMAS)["light"][K] extends string ? string : number;
};

const DIRECCION_INICIAL = new THREE.Vector3(1, 0.75, 1.25).normalize();

interface Controles {
  target: THREE.Vector3;
  update: () => void;
}

/**
 * Coloca la cámara para que el conjunto entre entero. Con `conservar` mantiene
 * el ángulo desde el que se está mirando y solo ajusta la distancia.
 */
function encuadrar(
  camara: THREE.Camera,
  controles: Controles,
  alto: number,
  radio: number,
  conservar: boolean,
) {
  // El modelo se dibuja centrado en planta y apoyado en el piso (ver `Escena`).
  const objetivo = new THREE.Vector3(0, alto / 2, 0);
  const direccion = camara.position.clone().sub(controles.target);
  if (!conservar || direccion.lengthSq() < 1e-6) direccion.copy(DIRECCION_INICIAL);
  direccion.normalize();

  const perspectiva = camara instanceof THREE.PerspectiveCamera ? camara : null;
  const distancia = (radio / Math.sin(THREE.MathUtils.degToRad((perspectiva?.fov ?? 35) / 2))) * 1.15;
  camara.position.copy(objetivo).addScaledVector(direccion, distancia);
  if (perspectiva) {
    perspectiva.near = distancia / 200;
    perspectiva.far = distancia * 50;
    perspectiva.updateProjectionMatrix();
  }
  controles.target.copy(objetivo);
  controles.update();
}

/**
 * Encuadra el modelo cada vez que cambia de tamaño. Conserva el ángulo desde el
 * que se está mirando: al mover un parámetro la pieza crece o encoge en su
 * sitio, sin que la cámara salte a la vista inicial.
 */
function Encuadre({ modelo }: { modelo: Modelo }) {
  const camara = useThree((s) => s.camera);
  const controles = useThree((s) => s.controls) as unknown as Controles | null;
  const invalidar = useThree((s) => s.invalidate);
  const yaEncuadrado = useRef(false);
  const alto = modelo.caja.max.y - modelo.caja.min.y;
  const radio = modelo.radio;

  useEffect(() => {
    if (!controles) return;
    encuadrar(camara, controles, alto, radio, yaEncuadrado.current);
    yaEncuadrado.current = true;
    invalidar();
  }, [camara, controles, invalidar, alto, radio]);

  return null;
}

/** Una geometría con solo los triángulos de una cara, para pintarla encima. */
function geometriaDeCara(geometria: THREE.BufferGeometry, cara: CaraMalla): THREE.BufferGeometry {
  const origen = geometria.getAttribute("position");
  const indice = geometria.index;
  const salida = new Float32Array(cara.triangulos.length * 9);
  let n = 0;
  for (const t of cara.triangulos) {
    for (let k = 0; k < 3; k++) {
      const v = indice ? indice.getX(t * 3 + k) : t * 3 + k;
      salida[n++] = origen.getX(v);
      salida[n++] = origen.getY(v);
      salida[n++] = origen.getZ(v);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(salida, 3));
  return g;
}

/** El resaltado de una cara: una capa opaca encima de sus triángulos. */
function ResaltadoCara({
  geometria,
  cara,
  color,
  opacidad,
}: {
  geometria: THREE.BufferGeometry;
  cara: CaraMalla;
  color: string;
  opacidad: number;
}) {
  const propia = useMemo(() => geometriaDeCara(geometria, cara), [geometria, cara]);
  useEffect(() => () => propia.dispose(), [propia]);
  return (
    <mesh geometry={propia} raycast={() => null} renderOrder={2}>
      {/* `polygonOffset` la adelanta lo justo para no pelearse con la cara de debajo. */}
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacidad}
        side={THREE.DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-4}
      />
    </mesh>
  );
}

/** Cuánto puede moverse el puntero entre pulsar y soltar para que cuente como clic, no como giro. */
const ARRASTRE_MAX = 4;

function Pieza({
  instancia,
  desplazamiento,
  activa,
  tema,
  alEntrar,
  alSalir,
  alPulsar,
  modoCaras,
  clavesCaras,
  carasSeleccionadas,
  caraBajoPuntero,
  alApuntarCara,
  alPulsarCara,
}: {
  instancia: Instancia;
  desplazamiento: THREE.Vector3;
  activa: boolean;
  tema: Tema;
  alEntrar: () => void;
  alSalir: () => void;
  alPulsar: () => void;
  modoCaras: boolean;
  /** La clave de cada cara, por geometría (las mismas que las de `ReferenciaCara`). */
  clavesCaras: string[][];
  carasSeleccionadas: ReadonlySet<string>;
  caraBajoPuntero: string | null;
  alApuntarCara: (geometria: number, cara: number | null) => void;
  alPulsarCara: (geometria: number, cara: number) => void;
}) {
  const parar = (e: ThreeEvent<PointerEvent | MouseEvent>, hacer: () => void) => {
    // Sin esto el rayo atraviesa el acrílico y resalta también la pieza de atrás.
    e.stopPropagation();
    hacer();
  };
  const caraDe = (g: number, e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const i = e.faceIndex == null ? -1 : (instancia.caras[g]?.caraDeTriangulo[e.faceIndex] ?? -1);
    return i >= 0 ? i : null;
  };

  return (
    <group position={desplazamiento}>
      {instancia.geometrias.map((geometria, g) => (
        <mesh
          key={geometria.uuid}
          geometry={geometria}
          castShadow
          onPointerOver={(e) => parar(e, modoCaras ? () => alApuntarCara(g, caraDe(g, e)) : alEntrar)}
          onPointerMove={modoCaras ? (e) => parar(e, () => alApuntarCara(g, caraDe(g, e))) : undefined}
          onPointerOut={(e) => parar(e, modoCaras ? () => alApuntarCara(g, null) : alSalir)}
          onClick={(e) =>
            parar(e, () => {
              if (!modoCaras) return alPulsar();
              if (e.delta > ARRASTRE_MAX) return;
              const cara = caraDe(g, e);
              if (cara !== null) alPulsarCara(g, cara);
            })
          }
        >
          {/*
            Transparencia por opacidad y no por `transmission`: un material con
            transmisión no ve a los demás objetos transparentes que tiene detrás,
            y en una caja de acrílico eso borra la pared del fondo. Con opacidad
            se ven todas las paredes, y `depthWrite` apagado evita que una tape a
            otra según el orden en que se dibujen.
          */}
          <meshPhysicalMaterial
            color={activa ? tema.activo : tema.acrilico}
            transparent
            opacity={activa ? Math.max(0.7, tema.opacidad) : tema.opacidad}
            roughness={0.06}
            metalness={0}
            ior={1.49}
            clearcoat={1}
            clearcoatRoughness={0.08}
            reflectivity={0.5}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
          <Edges
            threshold={20}
            color={activa ? tema.aristaActiva : tema.arista}
            lineWidth={activa ? 2 : 1}
          />
        </mesh>
      ))}
      {instancia.geometrias.flatMap((geometria, g) =>
        (instancia.caras[g]?.caras ?? []).map((cara, c) => {
          const clave = clavesCaras[g]?.[c];
          if (!clave) return null;
          const elegida = carasSeleccionadas.has(clave);
          const apuntada = modoCaras && caraBajoPuntero === clave;
          if (!elegida && !apuntada) return null;
          return (
            <ResaltadoCara
              key={clave}
              geometria={geometria}
              cara={cara}
              color={tema.activo}
              opacidad={elegida ? 0.85 : 0.4}
            />
          );
        }),
      )}
    </group>
  );
}

function Escena({
  modelo,
  explosion,
  piezaActiva,
  alCambiarPieza,
  tema,
  nombresPiezas,
  modoCaras,
  carasSeleccionadas,
  alAlternarCara,
}: {
  modelo: Modelo;
  explosion: number;
  piezaActiva: string | null;
  alCambiarPieza?: (id: string | null) => void;
  tema: Tema;
  nombresPiezas: Readonly<Record<string, string>>;
  modoCaras: boolean;
  carasSeleccionadas: ReadonlySet<string>;
  alAlternarCara?: (cara: ReferenciaCara) => void;
}) {
  const { caja, centro, radio } = modelo;
  const [caraBajoPuntero, setCaraBajoPuntero] = useState<string | null>(null);

  // Cada cara descrita como irá al chat: la clave sirve también para resaltarla.
  const referencias = useMemo(
    () =>
      modelo.instancias.map((instancia) =>
        instancia.geometrias.map((geometria, g) =>
          (instancia.caras[g]?.caras ?? []).map((cara) =>
            describirCara(cara, geometria.getAttribute("position").array, geometria.index?.array, {
              id: instancia.pieza,
              nombre: (instancia.pieza && nombresPiezas[instancia.pieza]) || instancia.pieza || "Pieza",
              copia: instancia.copia,
              de: instancia.de,
            }),
          ),
        ),
      ),
    [modelo, nombresPiezas],
  );
  const claves = useMemo(
    () => referencias.map((porGeometria) => porGeometria.map((caras) => caras.map((r) => r.clave))),
    [referencias],
  );

  const desplazamientos = useMemo(
    () =>
      modelo.instancias.map((i) => i.centro.clone().sub(centro).multiplyScalar(explosion)),
    [modelo, centro, explosion],
  );

  const sombra = radio * 2.5;

  return (
    <>
      <hemisphereLight args={["#ffffff", "#8a8f98", tema.ambiente]} />
      <ambientLight intensity={tema.ambiente * 0.35} />
      <directionalLight
        position={[radio * 1.5, radio * 3, radio * 2]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-sombra}
        shadow-camera-right={sombra}
        shadow-camera-top={sombra}
        shadow-camera-bottom={-sombra}
        shadow-camera-near={radio * 0.1}
        shadow-camera-far={radio * 10}
      />
      <directionalLight position={[-radio * 2, radio, -radio * 1.5]} intensity={0.5} />

      {/* Centrado en planta y apoyado en el piso: la rejilla queda en y = 0. */}
      <group position={[-centro.x, -caja.min.y, -centro.z]}>
        {modelo.instancias.map((instancia, n) => (
          <Pieza
            key={instancia.clave}
            instancia={instancia}
            desplazamiento={desplazamientos[n]}
            activa={instancia.pieza !== null && instancia.pieza === piezaActiva}
            tema={tema}
            alEntrar={() => alCambiarPieza?.(instancia.pieza)}
            alSalir={() => alCambiarPieza?.(null)}
            alPulsar={() => alCambiarPieza?.(instancia.pieza)}
            modoCaras={modoCaras}
            clavesCaras={claves[n]}
            carasSeleccionadas={carasSeleccionadas}
            caraBajoPuntero={caraBajoPuntero}
            alApuntarCara={(g, c) => setCaraBajoPuntero(c === null ? null : (claves[n][g]?.[c] ?? null))}
            alPulsarCara={(g, c) => {
              const ref = referencias[n][g]?.[c];
              if (ref) alAlternarCara?.(ref);
            }}
          />
        ))}
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[radio * 12, radio * 12]} />
        <shadowMaterial transparent opacity={0.18} />
      </mesh>
      <Grid
        position={[0, -0.1, 0]}
        infiniteGrid
        cellSize={10}
        sectionSize={100}
        cellThickness={0.6}
        sectionThickness={1}
        cellColor={tema.celda}
        sectionColor={tema.seccion}
        fadeDistance={radio * 14}
        fadeStrength={1.5}
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minDistance={radio * 0.3}
        maxDistance={radio * 12}
        maxPolarAngle={Math.PI * 0.495}
      />
      <Encuadre modelo={modelo} />
    </>
  );
}

export interface PropsVisor3D {
  /** `resultado.glb_base64` del motor. */
  glbBase64: string;
  /** Las medidas totales que declara el motor, en mm. */
  dimensiones?: { x: number; y: number; z: number } | null;
  /** Los `id` del despiece, para saber de qué pieza es cada nodo. */
  idsPiezas: readonly string[];
  piezaActiva?: string | null;
  alCambiarPieza?: (id: string | null) => void;
  /** El color del acrílico elegido; sin él, cristal. */
  tinte?: TinteAcrilico | null;
  /** El nombre de cada pieza por `id`, para describir las caras ("Base · cara superior"). */
  nombresPiezas?: Readonly<Record<string, string>>;
  /** Modo "seleccionar caras". Sin `alCambiarModoCaras` no se ofrece el botón. */
  modoCaras?: boolean;
  alCambiarModoCaras?: (activo: boolean) => void;
  /** Las claves de las caras ya señaladas (`ReferenciaCara.clave`). */
  carasSeleccionadas?: readonly string[];
  alAlternarCara?: (cara: ReferenciaCara) => void;
  className?: string;
}

const SIN_NOMBRES: Readonly<Record<string, string>> = {};
const SIN_CARAS: readonly string[] = [];

export default function Visor3D({
  glbBase64,
  dimensiones,
  idsPiezas,
  piezaActiva = null,
  alCambiarPieza,
  tinte = null,
  nombresPiezas = SIN_NOMBRES,
  modoCaras = false,
  alCambiarModoCaras,
  carasSeleccionadas = SIN_CARAS,
  alAlternarCara,
  className,
}: PropsVisor3D) {
  const seleccionadas = useMemo(() => new Set(carasSeleccionadas), [carasSeleccionadas]);
  const { resolvedTheme } = useTheme();
  const base: Tema = resolvedTheme === "dark" ? TEMAS.dark : TEMAS.light;
  const tema = useMemo<Tema>(
    () => (tinte ? { ...base, acrilico: tinte.color, opacidad: tinte.opacidad } : base),
    [base, tinte],
  );
  const { modelo, fallo } = useModelo(glbBase64, idsPiezas);
  const [explosion, setExplosion] = useState(0);

  // Si el motor no manda medidas se leen de la geometría. glTF lleva Y arriba:
  // el alto del diseño es la Y del modelo y el fondo, su Z.
  const medidas = useMemo(() => {
    if (dimensiones) return dimensiones;
    if (!modelo) return null;
    const t = modelo.caja.getSize(new THREE.Vector3());
    return { x: t.x, y: t.z, z: t.y };
  }, [dimensiones, modelo]);

  return (
    <div className={cn("relative h-full min-h-0 w-full overflow-hidden", className)}>
      {modelo ? (
        <Canvas
          shadows
          frameloop="demand"
          dpr={[1, 2]}
          camera={{ fov: 35, near: 1, far: 100000, position: [600, 450, 750] }}
          gl={{ antialias: true, alpha: true }}
          // En modo caras, un clic al vacío no deshace lo señalado.
          onPointerMissed={() => !modoCaras && alCambiarPieza?.(null)}
          className={modoCaras ? "cursor-crosshair" : undefined}
          aria-label="Vista 3D del diseño"
          role="img"
        >
          <Escena
            modelo={modelo}
            explosion={explosion}
            piezaActiva={piezaActiva}
            alCambiarPieza={alCambiarPieza}
            tema={tema}
            nombresPiezas={nombresPiezas}
            modoCaras={modoCaras}
            carasSeleccionadas={seleccionadas}
            alAlternarCara={alAlternarCara}
          />
        </Canvas>
      ) : fallo ? (
        <div className="text-muted-foreground grid h-full place-items-center p-6 text-center text-sm">
          <div>
            <TriangleAlert className="text-st-observado mx-auto mb-2 size-5" aria-hidden />
            No se pudo mostrar el modelo 3D. Las piezas y las descargas siguen disponibles.
          </div>
        </div>
      ) : null}

      {medidas && (
        <p
          className="bg-background/80 text-foreground/80 pointer-events-none absolute top-2 left-2 rounded-md border px-2 py-1 font-mono text-xs tabular-nums backdrop-blur"
          aria-label={`Medidas totales: ${medida(medidas.x)} por ${medida(medidas.y)} por ${medida(medidas.z)} milímetros`}
        >
          {medida(medidas.x)} × {medida(medidas.y)} × {medida(medidas.z)} mm
        </p>
      )}

      {modelo && alCambiarModoCaras && (
        <div className="absolute bottom-2 left-2 flex items-center gap-2">
          <button
            type="button"
            aria-pressed={modoCaras}
            onClick={() => alCambiarModoCaras(!modoCaras)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium backdrop-blur transition-colors",
              modoCaras
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background/80 text-foreground/80 hover:text-foreground",
            )}
          >
            <MousePointerClick className="size-3.5" aria-hidden />
            {modoCaras ? "Listo" : "Seleccionar caras"}
          </button>
          {modoCaras && (
            <span className="bg-background/80 text-muted-foreground hidden rounded-md border px-2 py-1 text-xs backdrop-blur sm:inline">
              {carasSeleccionadas.length
                ? `${carasSeleccionadas.length} señalada${carasSeleccionadas.length === 1 ? "" : "s"} para el chat`
                : "Toca una cara para referirla en el chat"}
            </span>
          )}
        </div>
      )}

      {modelo && modelo.instancias.length > 1 && (
        <div className="bg-background/80 absolute right-2 bottom-2 flex items-center gap-2 rounded-md border px-2 py-1.5 backdrop-blur">
          <span className="text-muted-foreground text-xs" id="visor-explosion">
            Separar piezas
          </span>
          <Slider.Root
            value={explosion}
            onValueChange={(v) => setExplosion(v)}
            min={0}
            max={1.5}
            step={0.05}
            aria-labelledby="visor-explosion"
            className="w-28"
          >
            <Slider.Control className="flex h-4 w-full touch-none items-center select-none">
              <Slider.Track className="bg-muted relative h-1 w-full rounded-full">
                <Slider.Indicator className="bg-primary rounded-full" />
                <Slider.Thumb className="bg-background border-primary focus-visible:ring-ring/50 size-3.5 rounded-full border-2 shadow-sm outline-none focus-visible:ring-3" />
              </Slider.Track>
            </Slider.Control>
          </Slider.Root>
        </div>
      )}
    </div>
  );
}
