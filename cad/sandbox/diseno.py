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

    # Un logo guardado con el diseño (sacado de un PDF), por su nombre:
    from diseno import caras_de_contorno, medidas_de_contorno
    ancho, alto = medidas_de_contorno("hurley")
    frente = [pieza(f"frente_{i}", "Frente", c, 3) for i, c in enumerate(caras_de_contorno("hurley"), 1)]

Todo en mm. El contorno vive en XY (z = 0) y se extruye hacia +Z local por el
espesor; `ubicar(origen, dir_u, dir_normal)` lo coloca en el conjunto armado
(Z hacia arriba).
"""

from __future__ import annotations

import math as _math
import re as _re
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
    "caras_de_contorno",
    "medidas_de_contorno",
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


# ---------------------------------------------------------------------------
# Contornos vectoriales (logos) guardados con el diseño
# ---------------------------------------------------------------------------

#: nombre → {ancho_mm, alto_mm, trazos}. Los pone el proceso hijo antes de ejecutar el código.
_CONTORNOS: dict[str, dict] = {}

#: Muestras por contorno para decidir qué trazo está dentro de cuál.
_MUESTRAS = 48
_TOL = 1e-6
_TOKEN = _re.compile(r"[MLCZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def _fijar_contornos(contornos: dict) -> None:
    """Deja disponibles los contornos del diseño (lo llama el proceso hijo, no el código del usuario)."""
    _CONTORNOS.clear()
    _CONTORNOS.update(contornos or {})


def _contorno(nombre: str) -> dict:
    try:
        return _CONTORNOS[nombre]
    except KeyError:
        disponibles = ", ".join(sorted(_CONTORNOS)) or "ninguno"
        raise ValueError(f"No hay un contorno llamado «{nombre}». Contornos disponibles: {disponibles}.") from None


def medidas_de_contorno(nombre: str) -> tuple[float, float]:
    """(ancho, alto) en mm del contorno guardado `nombre`: ya vienen a la medida pedida al extraerlo."""
    c = _contorno(nombre)
    return float(c["ancho_mm"]), float(c["alto_mm"])


def _aristas_de_trazo(d: str) -> list[_Edge]:
    """Las aristas de un trazo `d` de SVG con `M`, `L`, `C` y `Z` (en mm)."""
    fichas = _TOKEN.findall(d)
    aristas: list[_Edge] = []
    i = 0
    inicio = actual = None

    def numeros(n: int) -> list[float]:
        nonlocal i
        if i + n > len(fichas):
            raise ValueError("Un trazo del contorno está incompleto.")
        valores = [float(f) for f in fichas[i : i + n]]
        i += n
        return valores

    def unir(destino: tuple[float, float]) -> None:
        nonlocal actual
        if _math.hypot(destino[0] - actual[0], destino[1] - actual[1]) > _TOL:
            aristas.append(_Edge.make_line(_Vector(*actual, 0), _Vector(*destino, 0)))
        actual = destino

    while i < len(fichas):
        ficha = fichas[i]
        i += 1
        if ficha == "M":
            x, y = numeros(2)
            inicio = actual = (x, y)
        elif actual is None:
            raise ValueError("Un trazo del contorno no empieza con M.")
        elif ficha == "L":
            x, y = numeros(2)
            unir((x, y))
        elif ficha == "C":
            x1, y1, x2, y2, x, y = numeros(6)
            aristas.append(
                _Edge.make_bezier(_Vector(*actual, 0), _Vector(x1, y1, 0), _Vector(x2, y2, 0), _Vector(x, y, 0))
            )
            actual = (x, y)
        elif ficha == "Z":
            unir(inicio)
        else:
            raise ValueError(f"Un trazo del contorno trae «{ficha}» donde se esperaba una orden.")
    return aristas


def _poligono_de(alambre: _Wire) -> list[tuple[float, float]]:
    puntos = []
    for k in range(_MUESTRAS):
        p = alambre.position_at(k / _MUESTRAS)
        puntos.append((p.X, p.Y))
    return puntos


def _area_poligono(pts: list[tuple[float, float]]) -> float:
    n = len(pts)
    return abs(sum(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1] for k in range(n))) / 2


def _dentro(punto: tuple[float, float], pts: list[tuple[float, float]]) -> bool:
    """Punto en polígono (par-impar)."""
    x, y = punto
    dentro = False
    n = len(pts)
    for k in range(n):
        x0, y0 = pts[k]
        x1, y1 = pts[(k + 1) % n]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            dentro = not dentro
    return dentro


def caras_de_contorno(nombre: str) -> list[_Face]:
    """
    Las caras planas (en XY, en mm) de un logo guardado con el diseño, de izquierda
    a derecha: una por cada forma exterior, con sus agujeros (una «o» o una «B»
    traen el suyo). Un logo de varias formas (como «)(») devuelve varias caras:
    haz una pieza con cada una. Las curvas son las del dibujo original.
    """
    c = _contorno(nombre)
    cerrados: list[_Wire] = []
    for d in c["trazos"]:
        aristas = _aristas_de_trazo(d)
        if len(aristas) >= 1:
            cerrados.append(_Wire(aristas))
    if not cerrados:
        raise ValueError(f"El contorno «{nombre}» no tiene formas cerradas.")

    poligonos = [_poligono_de(a) for a in cerrados]
    areas = [_area_poligono(p) for p in poligonos]
    # Quién contiene a quién: la profundidad par es una forma exterior, la impar un agujero.
    contenedores = [
        [j for j in range(len(cerrados)) if j != i and areas[j] > areas[i] and _dentro(poligonos[i][0], poligonos[j])]
        for i in range(len(cerrados))
    ]
    agujeros: dict[int, list[_Wire]] = {}
    exteriores: list[int] = []
    for i, cont in enumerate(contenedores):
        if len(cont) % 2 == 0:
            exteriores.append(i)
            agujeros.setdefault(i, [])
        else:
            # El agujero es del contenedor más pequeño (el más cercano).
            padre = min(cont, key=lambda j: areas[j])
            agujeros.setdefault(padre, []).append(cerrados[i])

    caras = []
    for i in sorted(exteriores, key=lambda k: min(p[0] for p in poligonos[k])):
        cara = _orientar(_Face(cerrados[i]))
        caras.append(_con_agujeros(cara, agujeros.get(i, [])) if agujeros.get(i) else cara)
    return caras
