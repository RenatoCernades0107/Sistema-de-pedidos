"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Canvas, useFrame } from "@react-three/fiber";
import { Edges, Grid } from "@react-three/drei";
import type * as THREE from "three";
import { TEMAS } from "./visor-3d";

/** Las medidas de la caja de muestra, en mm (como los modelos del motor). */
const CAJA: [number, number, number] = [220, 150, 140];

/** Una caja de acrílico "fantasma" que gira despacio sobre la rejilla. */
function CajaFantasma({ girar, acrilico, arista }: { girar: boolean; acrilico: string; arista: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (girar && ref.current) ref.current.rotation.y += delta * 0.25;
  });
  return (
    <group ref={ref} position={[0, CAJA[1] / 2, 0]} rotation={[0, Math.PI / 6, 0]}>
      <mesh>
        <boxGeometry args={CAJA} />
        <meshPhysicalMaterial
          color={acrilico}
          transparent
          opacity={0.16}
          roughness={0.1}
          metalness={0}
          depthWrite={false}
        />
        <Edges color={arista} transparent opacity={0.45} />
      </mesh>
    </group>
  );
}

/**
 * Lo que se ve en el visor antes de que haya un modelo: la misma rejilla del
 * visor, con perspectiva, y una caja translúcida de muestra. Solo decora; no
 * se puede tocar. Sin animación si el sistema pide reducir el movimiento.
 */
export default function EscenaVacia() {
  const { resolvedTheme } = useTheme();
  const tema = resolvedTheme === "dark" ? TEMAS.dark : TEMAS.light;
  const [girar, setGirar] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const revisar = () => setGirar(!mq.matches);
    revisar();
    mq.addEventListener("change", revisar);
    return () => mq.removeEventListener("change", revisar);
  }, []);

  return (
    <Canvas
      frameloop={girar ? "always" : "demand"}
      dpr={[1, 2]}
      camera={{ fov: 35, near: 1, far: 100000, position: [600, 420, 750] }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ camera }) => camera.lookAt(0, 60, 0)}
      aria-hidden
      className="pointer-events-none"
    >
      <ambientLight intensity={tema.ambiente} />
      <directionalLight position={[400, 800, 500]} intensity={1.2} />
      <CajaFantasma girar={girar} acrilico={tema.acrilico} arista={tema.arista} />
      <Grid
        position={[0, -0.1, 0]}
        infiniteGrid
        cellSize={10}
        sectionSize={100}
        cellThickness={0.6}
        sectionThickness={1}
        cellColor={tema.celda}
        sectionColor={tema.seccion}
        fadeDistance={2200}
        fadeStrength={1.5}
      />
    </Canvas>
  );
}
