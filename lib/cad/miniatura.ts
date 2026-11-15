/**
 * La foto PNG de un modelo 3D, para las tarjetas (catálogo de productos
 * terminados y lista de diseños).
 *
 * Se saca en el navegador a partir del GLB que ya devolvió el motor, con un
 * renderer propio fuera de pantalla: un solo contexto WebGL que se suelta al
 * terminar, sin depender del visor que haya montado. Imita el aspecto del
 * visor (`components/disenos/visor-3d.tsx`): acrílico translúcido con sus
 * aristas, visto desde el mismo ángulo, en el tema claro.
 *
 * Solo para el navegador: necesita `document` y WebGL.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { TinteAcrilico } from "./colores";

export const ANCHO_MINIATURA = 480;
export const ALTO_MINIATURA = 300;

const ACRILICO = "#cfe9f5";
const ARISTA = "#2f4858";
const OPACIDAD = 0.45;
/** El mismo ángulo con el que abre el visor. */
const DIRECCION = new THREE.Vector3(1, 0.75, 1.25).normalize();
const FOV = 30;

function bytesDe(base64: string): ArrayBuffer {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes.buffer;
}

function liberar(raiz: THREE.Object3D) {
  raiz.traverse((o) => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.LineSegments)) return;
    o.geometry.dispose();
    const materiales: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materiales) m.dispose();
  });
}

/**
 * El PNG del modelo, con fondo transparente. `tinte` es el color del acrílico
 * elegido; sin él, cristal.
 */
export async function renderizarMiniatura(glbBase64: string, tinte?: TinteAcrilico | null): Promise<Blob> {
  const gltf = await new GLTFLoader().parseAsync(bytesDe(glbBase64), "");
  const escena = new THREE.Scene();
  const modelo = new THREE.Group();

  // Las mallas se copian con un material de acrílico (el del GLB es el gris del
  // motor) y se pasan a mm: glTF viene en metros.
  const material = new THREE.MeshStandardMaterial({
    color: tinte?.color ?? ACRILICO,
    transparent: true,
    opacity: Math.max(OPACIDAD, tinte?.opacidad ?? 0),
    roughness: 0.15,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const arista = new THREE.LineBasicMaterial({ color: ARISTA });
  const aMm = new THREE.Matrix4().makeScale(1000, 1000, 1000);
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometria = (o.geometry as THREE.BufferGeometry).clone();
    geometria.applyMatrix4(new THREE.Matrix4().multiplyMatrices(aMm, o.matrixWorld));
    geometria.computeVertexNormals();
    modelo.add(new THREE.Mesh(geometria, material));
    modelo.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometria, 20), arista));
  });
  liberar(gltf.scene);

  const caja = new THREE.Box3().setFromObject(modelo);
  if (caja.isEmpty()) {
    liberar(modelo);
    throw new Error("El modelo no tiene geometría.");
  }
  // Centrado en planta y apoyado en el piso, como en el visor.
  const centro = caja.getCenter(new THREE.Vector3());
  modelo.position.set(-centro.x, -caja.min.y, -centro.z);
  escena.add(modelo);
  const alto = caja.max.y - caja.min.y;
  const radio = caja.getBoundingSphere(new THREE.Sphere()).radius;

  escena.add(new THREE.HemisphereLight("#ffffff", "#8a8f98", 1.1));
  escena.add(new THREE.AmbientLight("#ffffff", 0.4));
  const luz = new THREE.DirectionalLight("#ffffff", 1.2);
  luz.position.set(radio * 1.5, radio * 3, radio * 2);
  escena.add(luz);
  const contraluz = new THREE.DirectionalLight("#ffffff", 0.5);
  contraluz.position.set(-radio * 2, radio, -radio * 1.5);
  escena.add(contraluz);

  // La esfera envolvente entra entera por el lado más angosto del encuadre.
  const camara = new THREE.PerspectiveCamera(FOV, ANCHO_MINIATURA / ALTO_MINIATURA);
  const mitad = THREE.MathUtils.degToRad(FOV / 2);
  const distancia = (radio / Math.sin(mitad)) * 1.02;
  const objetivo = new THREE.Vector3(0, alto / 2, 0);
  camara.position.copy(objetivo).addScaledVector(DIRECCION, distancia);
  camara.near = distancia / 200;
  camara.far = distancia * 50;
  camara.lookAt(objetivo);
  camara.updateProjectionMatrix();

  const lienzo = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true, preserveDrawingBuffer: true });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(ANCHO_MINIATURA, ALTO_MINIATURA, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(escena, camara);
    return await new Promise<Blob>((resolver, rechazar) =>
      lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error("No se pudo crear la imagen."))), "image/png"),
    );
  } finally {
    liberar(modelo);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

