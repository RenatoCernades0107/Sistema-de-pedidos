"""
Formas planas con curvas reales (arcos y círculos) y texto.

Todo vive en el plano XY. Los arcos y círculos se construyen como aristas
circulares de verdad, así que el DXF los escribe como `ARC`/`CIRCLE` y no como
tramos rectos.
"""

from __future__ import annotations

import math
import os
from functools import lru_cache
from pathlib import Path

from build123d import Edge, Face, Location, Vector, Wire

from .base import orientar

#: Fuentes que se prueban, en orden, si no se define `CAD_FUENTE`. En la imagen
#: Docker la primera viene del paquete Debian `fonts-dejavu-core`.
FUENTES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
)


class SinFuente(RuntimeError):
    pass


def ruta_fuente() -> str:
    """Archivo de fuente para letras y grabados: `CAD_FUENTE` o la primera de `FUENTES` que exista."""
    propia = os.environ.get("CAD_FUENTE")
    for ruta in ([propia] if propia else []) + list(FUENTES):
        if ruta and Path(ruta).is_file():
            return ruta
    raise SinFuente("No hay ninguna fuente instalada para dibujar texto (instale fonts-dejavu-core).")


def _punto(x: float, y: float) -> Vector:
    return Vector(x, y, 0)


def contorno_redondeado(ancho: float, alto: float, radio: float, x0: float = 0, y0: float = 0) -> Wire:
    """Rectángulo `ancho × alto` con esquina en (x0, y0) y esquinas de radio `radio` (0 = vivas)."""
    r = max(0.0, min(radio, ancho / 2, alto / 2))
    x1, y1 = x0 + ancho, y0 + alto
    if r <= 1e-9:
        return Wire.make_polygon([_punto(x0, y0), _punto(x1, y0), _punto(x1, y1), _punto(x0, y1)], close=True)
    aristas: list[Edge] = []
    # (centro de la esquina, ángulo inicial) en sentido antihorario
    esquinas = (((x1 - r, y0 + r), -90), ((x1 - r, y1 - r), 0), ((x0 + r, y1 - r), 90), ((x0 + r, y0 + r), 180))
    puntos = []
    for (cx, cy), a in esquinas:
        p0 = _punto(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
        pm = _punto(cx + r * math.cos(math.radians(a + 45)), cy + r * math.sin(math.radians(a + 45)))
        p1 = _punto(cx + r * math.cos(math.radians(a + 90)), cy + r * math.sin(math.radians(a + 90)))
        puntos.append((p0, pm, p1))
    for i, (p0, pm, p1) in enumerate(puntos):
        aristas.append(Edge.make_three_point_arc(p0, pm, p1))
        siguiente = puntos[(i + 1) % 4][0]
        if (siguiente - p1).length > 1e-9:
            aristas.append(Edge.make_line(p1, siguiente))
    return Wire(aristas)


def cara_redondeada(ancho: float, alto: float, radio: float) -> Face:
    """Rectángulo con esquinas redondeadas, con una esquina en el origen."""
    return orientar(Face(contorno_redondeado(ancho, alto, radio)))


def circulo(cx: float, cy: float, diametro: float) -> Wire:
    return Wire([Edge.make_circle(diametro / 2).moved(Location((cx, cy, 0)))])


def ranura(cx: float, cy: float, largo: float, ancho: float) -> Wire:
    """Ranura horizontal de puntas redondas: `largo` total en X, `ancho` en Y, centrada en (cx, cy)."""
    r = ancho / 2
    if largo <= ancho + 1e-9:
        return circulo(cx, cy, ancho)
    a, b = cx - largo / 2 + r, cx + largo / 2 - r
    return Wire(
        [
            Edge.make_line(_punto(a, cy - r), _punto(b, cy - r)),
            Edge.make_three_point_arc(_punto(b, cy - r), _punto(b + r, cy), _punto(b, cy + r)),
            Edge.make_line(_punto(b, cy + r), _punto(a, cy + r)),
            Edge.make_three_point_arc(_punto(a, cy + r), _punto(a - r, cy), _punto(a, cy - r)),
        ]
    )


@lru_cache(maxsize=64)
def _texto_bruto(texto: str, fuente: str, tamano: float = 100.0) -> tuple[Face, ...]:
    from build123d import Text

    return tuple(Text(texto, tamano, font_path=fuente).faces())


def caras_texto(texto: str, alto: float, ancho_max: float | None = None) -> list[Face]:
    """
    Las letras de `texto` como caras planas (con sus agujeros), escaladas para
    que el conjunto mida exactamente `alto` (o menos, si así no pasa de
    `ancho_max`) y con la esquina inferior izquierda de su caja en el origen.
    """
    caras = [orientar(c) for c in _texto_bruto(texto, ruta_fuente())]
    if not caras:
        return []
    x0, y0, x1, y1 = _caja(caras)
    escala = alto / (y1 - y0)
    if ancho_max is not None and (x1 - x0) * escala > ancho_max:
        escala = ancho_max / (x1 - x0)
    # se vuelve a dibujar al tamaño final (escalar una cara con ubicación no
    # escala su desplazamiento y las letras se pisan)
    caras = [orientar(c) for c in _texto_bruto(texto, ruta_fuente(), 100.0 * escala)]
    x0, y0, _, _ = _caja(caras)
    return [c.moved(Location((-x0, -y0, 0))) for c in caras]


def _caja(caras: list[Face]) -> tuple[float, float, float, float]:
    cajas = [c.bounding_box() for c in caras]
    return (
        min(b.min.X for b in cajas),
        min(b.min.Y for b in cajas),
        max(b.max.X for b in cajas),
        max(b.max.Y for b in cajas),
    )


def medidas_texto(texto: str, alto: float, ancho_max: float | None = None) -> tuple[float, float]:
    """(ancho, alto) del texto tal como lo deja `caras_texto`."""
    caras = caras_texto(texto, alto, ancho_max)
    if not caras:
        return (0.0, 0.0)
    _, _, x1, y1 = _caja(caras)
    return (x1, y1)
