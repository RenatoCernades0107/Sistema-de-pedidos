"""
Módulo público `diseno` para el código del diseño libre.

Es lo único (además de `build123d` y `math`) que el código del LLM puede
importar. Envuelve los tipos del marco de plantillas (`motor/plantillas/base.py`)
para que un diseño libre sea, igual que una plantilla, una lista de **piezas
planas** con sus ubicaciones, y no un sólido arbitrario.

Contrato:

    from diseno import pieza, rectangulo, poligono, circulo, ranura, con_agujeros, ubicar

    lado = pieza("lado", "Lado", rectangulo(100, 80), 3,
                 ubicaciones=[ubicar((0, 0, 0), (1, 0, 0), (0, 1, 0))])
    piezas = [lado]

Todo en mm. El contorno vive en XY (z = 0) y se extruye hacia +Z local por el
espesor; `ubicar(origen, dir_u, dir_normal)` lo coloca en el conjunto armado
(Z hacia arriba).
"""

from __future__ import annotations

import math as _math
from typing import Iterable as _Iterable, Sequence as _Sequence

from build123d import Edge as _Edge, Face as _Face, Location as _Location, Vector as _Vector, Wire as _Wire

from motor.plantillas.base import (
    Pieza,
    cara_poligono as _cara_poligono,
    con_agujeros as _con_agujeros,
    orientar as _orientar,
    ubicar as _ubicar,
)

__all__ = [
    "Pieza",
    "pieza",
    "rectangulo",
    "poligono",
    "circulo",
    "ranura",
    "agujero_circular",
    "agujero_rectangular",
    "con_agujeros",
    "ubicar",
    "linea",
]


def pieza(
    id: str,
    nombre: str,
    contorno: _Face,
    espesor: float,
    ubicaciones: _Sequence[_Location] | None = None,
    grabado: _Sequence[_Edge] | None = None,
) -> Pieza:
    """Una pieza plana: contorno (cara en XY), espesor en mm, ubicaciones y trazos de grabado."""
    if not isinstance(contorno, _Face):
        raise TypeError("El contorno de una pieza debe ser una cara plana (Face) en XY.")
    return Pieza(
        id=str(id),
        nombre=str(nombre),
        contorno=contorno,
        espesor_mm=float(espesor),
        ubicaciones=list(ubicaciones) if ubicaciones else [_Location()],
        grabado=list(grabado or []),
    )


def rectangulo(ancho: float, alto: float, x: float = 0, y: float = 0) -> _Face:
    """Rectángulo con la esquina inferior izquierda en (x, y)."""
    return _cara_poligono([(x, y), (x + ancho, y), (x + ancho, y + alto), (x, y + alto)])


def poligono(puntos: _Sequence[tuple[float, float]]) -> _Face:
    """Cara a partir de los vértices de un polígono cerrado."""
    return _cara_poligono(puntos)


def circulo(radio: float, cx: float = 0, cy: float = 0) -> _Face:
    """Disco de radio `radio` centrado en (cx, cy)."""
    borde = _Wire([_Edge.make_circle(radio).moved(_Location((cx, cy, 0)))])
    return _orientar(_Face(borde))


def agujero_rectangular(x: float, y: float, ancho: float, alto: float) -> _Wire:
    """Contorno interior rectangular (para ranuras de encastre)."""
    pts = [(x, y), (x + ancho, y), (x + ancho, y + alto), (x, y + alto)]
    return _Wire.make_polygon([_Vector(a, b, 0) for a, b in pts], close=True)


def ranura(x: float, y: float, ancho: float, alto: float) -> _Wire:
    """Alias de `agujero_rectangular`: ranura de encastre con esquina en (x, y)."""
    return agujero_rectangular(x, y, ancho, alto)


def agujero_circular(radio: float, cx: float, cy: float) -> _Wire:
    """Contorno interior circular."""
    return _Wire([_Edge.make_circle(radio).moved(_Location((cx, cy, 0)))])


def con_agujeros(cara: _Face, agujeros: _Iterable[_Wire]) -> _Face:
    """La misma cara con contornos interiores (agujeros o ranuras)."""
    return _con_agujeros(cara, list(agujeros))


def ubicar(origen: _Sequence[float], dir_u: _Sequence[float], dir_normal: _Sequence[float]) -> _Location:
    """
    Coloca una pieza: su origen local va a `origen`, su eje X local apunta a
    `dir_u` y su espesor crece hacia `dir_normal`. El eje Y local queda en
    `dir_normal × dir_u`.
    """
    return _ubicar(origen, dir_u, dir_normal)


def linea(x0: float, y0: float, x1: float, y1: float) -> _Edge:
    """Trazo recto de grabado, en coordenadas del contorno."""
    return _Edge.make_line(_Vector(x0, y0, 0), _Vector(x1, y1, 0))


# `math` queda accesible como `diseno.pi` por comodidad.
pi = _math.pi
