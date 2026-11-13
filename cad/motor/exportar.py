"""
Exportación de un diseño: GLB (render 3D), STEP (conjunto armado) y DXF (corte).

Los tres salen de la misma lista de piezas del `Diseno`: el GLB y el STEP de
los contornos extruidos y ubicados, el DXF de los contornos acostados.

DXF
---
Se escribe con ezdxf en **R12 (AC1009) ASCII**, que es lo que RDWorks importa
con más fiabilidad (y CorelDRAW lo abre sin problema); es el mismo formato de
`lib/cortes/dxf.ts`. Unidades en mm (`$INSUNITS = 4`). Solo entidades `LINE`,
`ARC` y `CIRCLE`: las curvas circulares salen como curvas reales; cualquier
otra curva (spline, elipse) se aproxima con tramos rectos cortos. La capa y el
color van también en cada entidad, porque RDWorks agrupa por color.

  CORTE    color 1 (rojo)   contornos que se cortan
  GRABADO  color 3 (verde)  trazos que se graban
"""

from __future__ import annotations

import io
import json
import logging
import math
import re
import struct
from dataclasses import dataclass
from typing import Any

import ezdxf
import numpy as np
from build123d import Compound, Edge, Face, GeomType, Kind, Wire, export_step

from .plantillas.base import Diseno, Pieza
from .validacion import plancha_maxima

# ezdxf avisa en cada escritura de que R12 no lleva $INSUNITS; la añadimos nosotros.
logging.getLogger("ezdxf").setLevel(logging.ERROR)

CAPAS_DXF = {"CORTE": 1, "GRABADO": 3}
SEPARACION_MM = 5.0


# --------------------------------------------------------------------------
# GLB
# --------------------------------------------------------------------------

#: Acrílico transparente con un toque celeste.
MATERIAL_GLB = {
    "name": "acrilico",
    "pbrMetallicRoughness": {
        "baseColorFactor": [0.78, 0.9, 0.96, 0.55],
        "metallicFactor": 0.0,
        "roughnessFactor": 0.12,
    },
    "alphaMode": "BLEND",
    "doubleSided": True,
}


def _triangulos(solido: Any, tolerancia: float, angular: float) -> tuple[np.ndarray, np.ndarray]:
    """
    Triángulos de un sólido ya en ejes glTF (metros, Y arriba), con sombreado
    plano: cada triángulo lleva sus tres vértices y su propia normal.
    """
    vertices, caras = solido.tessellate(tolerancia, angular)
    v = np.array([(p.X, p.Y, p.Z) for p in vertices], dtype=np.float64)
    t = np.array(caras, dtype=np.int64).reshape(-1, 3)
    # CAD (mm, Z arriba) → glTF (m, Y arriba): (x, y, z) → (x, z, −y) / 1000
    v = np.column_stack([v[:, 0], v[:, 2], -v[:, 1]]) / 1000.0
    tri = v[t]  # (n, 3, 3)
    normales = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    largo = np.linalg.norm(normales, axis=1)
    validos = largo > 1e-18
    tri, normales = tri[validos], normales[validos] / largo[validos][:, None]
    posiciones = tri.reshape(-1, 3).astype(np.float32)
    normales = np.repeat(normales, 3, axis=0).astype(np.float32)
    return posiciones, normales


def exportar_glb(diseno: Diseno, tolerancia: float = 0.05, angular: float = 0.3) -> bytes:
    """
    glTF binario del conjunto armado: un nodo con nombre por instancia de pieza
    (`<id>` o `<id>_<n>`), todos hijos de la escena.
    """
    binario = bytearray()
    vistas: list[dict[str, Any]] = []
    accesores: list[dict[str, Any]] = []
    mallas: list[dict[str, Any]] = []
    nodos: list[dict[str, Any]] = []

    def agregar(datos: np.ndarray, con_limites: bool) -> int:
        desde = len(binario)
        binario.extend(datos.tobytes())
        while len(binario) % 4:
            binario.append(0)
        vistas.append({"buffer": 0, "byteOffset": desde, "byteLength": datos.nbytes, "target": 34962})
        accesor: dict[str, Any] = {
            "bufferView": len(vistas) - 1,
            "componentType": 5126,
            "count": int(datos.shape[0]),
            "type": "VEC3",
        }
        if con_limites:
            accesor["min"] = [float(x) for x in datos.min(axis=0)]
            accesor["max"] = [float(x) for x in datos.max(axis=0)]
        accesores.append(accesor)
        return len(accesores) - 1

    for inst in diseno.instancias:
        posiciones, normales = _triangulos(inst.solido, tolerancia, angular)
        if len(posiciones) == 0:
            raise ValueError(f"No se pudo teselar la pieza «{inst.nombre}».")
        a_pos = agregar(posiciones, True)
        a_nor = agregar(normales, False)
        mallas.append(
            {
                "name": inst.nombre,
                "primitives": [{"attributes": {"POSITION": a_pos, "NORMAL": a_nor}, "material": 0, "mode": 4}],
            }
        )
        nodos.append(
            {
                "name": inst.nombre,
                "mesh": len(mallas) - 1,
                "extras": {"pieza": inst.pieza.id, "espesor_mm": inst.pieza.espesor_mm},
            }
        )

    gltf = {
        "asset": {"version": "2.0", "generator": "motor-cad Plexiacril"},
        "scene": 0,
        "scenes": [{"name": diseno.plantilla.codigo, "nodes": list(range(len(nodos)))}],
        "nodes": nodos,
        "meshes": mallas,
        "materials": [MATERIAL_GLB],
        "accessors": accesores,
        "bufferViews": vistas,
        "buffers": [{"byteLength": len(binario)}],
    }
    texto = json.dumps(gltf, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    texto += b" " * (-len(texto) % 4)
    total = 12 + 8 + len(texto) + 8 + len(binario)
    salida = bytearray()
    salida += struct.pack("<4sII", b"glTF", 2, total)
    salida += struct.pack("<I4s", len(texto), b"JSON") + texto
    salida += struct.pack("<I4s", len(binario), b"BIN\x00") + bytes(binario)
    return bytes(salida)


def leer_json_glb(glb: bytes) -> dict[str, Any]:
    """El bloque JSON de un GLB (para pruebas y diagnóstico)."""
    magia, version, _ = struct.unpack_from("<4sII", glb, 0)
    if magia != b"glTF" or version != 2:
        raise ValueError("No es un GLB 2.0.")
    largo, tipo = struct.unpack_from("<I4s", glb, 12)
    if tipo != b"JSON":
        raise ValueError("El primer bloque del GLB no es JSON.")
    return json.loads(glb[20 : 20 + largo].decode("utf-8"))


# --------------------------------------------------------------------------
# STEP
# --------------------------------------------------------------------------


def exportar_step(diseno: Diseno) -> bytes:
    """STEP del conjunto armado, con una pieza con nombre por instancia."""
    conjunto = Compound(label=diseno.plantilla.codigo, children=[i.solido for i in diseno.instancias])
    salida = io.BytesIO()
    if not export_step(conjunto, salida):
        raise ValueError("No se pudo escribir el STEP.")
    return salida.getvalue()


# --------------------------------------------------------------------------
# DXF
# --------------------------------------------------------------------------


@dataclass
class Colocada:
    """Una copia de una pieza acostada en el DXF."""

    pieza: Pieza
    copia: int
    #: Contornos a cortar, ya compensados por el kerf.
    contornos: list[Wire]
    #: Caja de lo que se corta, en coordenadas de la pieza: (xmin, ymin, xmax, ymax).
    caja: tuple[float, float, float, float]
    #: Desplazamiento que lleva la pieza a su sitio en la plancha.
    dx: float = 0.0
    dy: float = 0.0

    @property
    def rect(self) -> tuple[float, float, float, float]:
        """Caja ya colocada: (xmin, ymin, xmax, ymax)."""
        x0, y0, x1, y1 = self.caja
        return (x0 + self.dx, y0 + self.dy, x1 + self.dx, y1 + self.dy)


def _desplazar(contorno: Wire, distancia: float) -> Wire:
    """
    Contorno paralelo a `distancia` mm: positivo agranda lo que encierra,
    negativo lo achica. Con esquinas vivas (sin arcos diminutos).
    """
    area = Face(contorno).area
    for signo in (1, -1):
        try:
            nuevo = contorno.offset_2d(signo * distancia, kind=Kind.INTERSECTION)
        except Exception:
            continue
        if not isinstance(nuevo, Wire) or not nuevo.is_closed:
            continue
        if (Face(nuevo).area > area) == (distancia > 0):
            return nuevo
    raise ValueError("No se pudo compensar el kerf de un contorno.")


def contornos_de_corte(pieza: Pieza, kerf_mm: float = 0.0) -> list[Wire]:
    """
    Lo que recorre el láser para sacar la pieza a su medida: con kerf, el
    contorno exterior se corre medio kerf hacia afuera y los interiores medio
    kerf hacia adentro.
    """
    exterior = pieza.contorno.outer_wire()
    interiores = list(pieza.contorno.inner_wires())
    if kerf_mm <= 0:
        return [exterior, *interiores]
    medio = kerf_mm / 2
    salida = [_desplazar(exterior, medio)]
    for agujero in interiores:
        try:
            salida.append(_desplazar(agujero, -medio))
        except ValueError:
            # un agujero más chico que el kerf no se puede compensar: va tal cual
            salida.append(agujero)
    return salida


def _caja_de(contornos: list[Wire]) -> tuple[float, float, float, float]:
    cajas = [c.bounding_box() for c in contornos]
    return (
        min(b.min.X for b in cajas),
        min(b.min.Y for b in cajas),
        max(b.max.X for b in cajas),
        max(b.max.Y for b in cajas),
    )


def acomodar(
    diseno: Diseno,
    kerf_mm: float = 0.0,
    separacion_mm: float = SEPARACION_MM,
    ancho_max_mm: float | None = None,
) -> list[Colocada]:
    """
    Acuesta todas las copias de todas las piezas en filas, de izquierda a
    derecha y de abajo hacia arriba, separadas `separacion_mm` y sin pasar del
    ancho de la plancha.
    """
    ancho_max = ancho_max_mm if ancho_max_mm is not None else plancha_maxima()[0]
    separacion = max(0.0, separacion_mm)
    colocadas: list[Colocada] = []
    x = y = alto_fila = 0.0
    for pieza in diseno.piezas:
        contornos = contornos_de_corte(pieza, kerf_mm)
        caja = _caja_de(contornos)
        ancho, alto = caja[2] - caja[0], caja[3] - caja[1]
        for copia in range(1, pieza.cantidad + 1):
            if x > 0 and x + ancho > ancho_max + 1e-9:
                x = 0.0
                y += alto_fila + separacion
                alto_fila = 0.0
            colocadas.append(Colocada(pieza, copia, contornos, caja, dx=x - caja[0], dy=y - caja[1]))
            x += ancho + separacion
            alto_fila = max(alto_fila, alto)
    return colocadas


def _angulo(cx: float, cy: float, p: Any) -> float:
    return math.degrees(math.atan2(p.Y - cy, p.X - cx)) % 360.0


def _dibujar_arista(msp: Any, arista: Edge, dx: float, dy: float, capa: str) -> None:
    atributos = {"layer": capa, "color": CAPAS_DXF[capa]}
    tipo = arista.geom_type
    if tipo == GeomType.LINE:
        a, b = arista @ 0, arista @ 1
        msp.add_line((a.X + dx, a.Y + dy), (b.X + dx, b.Y + dy), dxfattribs=atributos)
        return
    if tipo == GeomType.CIRCLE:
        centro, radio = arista.arc_center, arista.radius
        a, b = arista @ 0, arista @ 1
        if (a - b).length < 1e-7:
            msp.add_circle((centro.X + dx, centro.Y + dy), radio, dxfattribs=atributos)
            return
        # ARC en DXF va siempre en sentido antihorario: se ordenan los extremos
        # mirando por dónde pasa el punto medio.
        a0, a1 = _angulo(centro.X, centro.Y, a), _angulo(centro.X, centro.Y, b)
        am = _angulo(centro.X, centro.Y, arista @ 0.5)
        if not ((am - a0) % 360.0 <= (a1 - a0) % 360.0):
            a0, a1 = a1, a0
        msp.add_arc((centro.X + dx, centro.Y + dy), radio, a0, a1, dxfattribs=atributos)
        return
    # Otra curva: tramos rectos de como mucho 0.5 mm (y al menos 8).
    n = max(8, math.ceil(arista.length / 0.5))
    puntos = [arista @ (i / n) for i in range(n + 1)]
    for a, b in zip(puntos, puntos[1:]):
        msp.add_line((a.X + dx, a.Y + dy), (b.X + dx, b.Y + dy), dxfattribs=atributos)


def exportar_dxf(
    diseno: Diseno,
    kerf_mm: float = 0.0,
    separacion_mm: float = SEPARACION_MM,
    ancho_max_mm: float | None = None,
) -> bytes:
    """DXF R12 con todas las piezas acostadas, listo para RDWorks o CorelDRAW."""
    doc = ezdxf.new("R12")
    doc.header["$MEASUREMENT"] = 1  # métrico
    if "Defpoints" in doc.layers:
        doc.layers.remove("Defpoints")
    for capa, color in CAPAS_DXF.items():
        doc.layers.add(capa, color=color)
    msp = doc.modelspace()

    colocadas = acomodar(diseno, kerf_mm, separacion_mm, ancho_max_mm)
    for c in colocadas:
        for arista in c.pieza.grabado:
            _dibujar_arista(msp, arista, c.dx, c.dy, "GRABADO")
    for c in colocadas:
        for contorno in c.contornos:
            for arista in contorno.edges():
                _dibujar_arista(msp, arista, c.dx, c.dy, "CORTE")

    texto = io.StringIO()
    doc.write(texto)
    extension = None
    if colocadas:
        extension = (
            min(c.rect[0] for c in colocadas),
            min(c.rect[1] for c in colocadas),
            max(c.rect[2] for c in colocadas),
            max(c.rect[3] for c in colocadas),
        )
    return _cabecera_mm(texto.getvalue(), extension).encode("ascii", errors="replace")


def _cabecera_mm(dxf: str, extension: tuple[float, float, float, float] | None) -> str:
    """
    Retoca la cabecera que escribe ezdxf para R12:

      - añade `$INSUNITS = 4` (milímetros). ezdxf no la escribe en R12 porque la
        variable es posterior, pero RDWorks y CorelDRAW la leen igual; sin ella
        el archivo se podría tomar en pulgadas (igual que en `lib/cortes/dxf.ts`).
      - pone la extensión real del dibujo en `$EXTMIN` / `$EXTMAX`.
    """
    dxf = dxf.replace("\r\n", "\n")
    if "$INSUNITS" not in dxf:
        dxf, n = re.subn(r"(  9\n\$ACADVER\n  1\nAC1009\n)", r"\1  9\n$INSUNITS\n 70\n4\n", dxf, count=1)
        if n != 1:
            raise ValueError("No se pudo declarar las unidades en la cabecera del DXF.")
    if extension is not None:
        x0, y0, x1, y1 = extension
        for variable, (x, y) in (("$EXTMIN", (x0, y0)), ("$EXTMAX", (x1, y1))):
            dxf = re.sub(
                r"(  9\n" + re.escape(variable) + r"\n) 10\n[^\n]*\n 20\n[^\n]*\n 30\n[^\n]*\n",
                lambda m, x=x, y=y: f"{m.group(1)} 10\n{x:.6f}\n 20\n{y:.6f}\n 30\n0.0\n",
                dxf,
                count=1,
            )
    return dxf
