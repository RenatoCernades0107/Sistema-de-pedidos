"""
Contornos con dedos de encastre.

Una pieza dentada se describe sobre su rectángulo completo `ancho × alto`. A lo
largo de cada lado hay una franja del grosor del material (`e`) repartida en
**tramos**: en cada tramo la pieza o bien llega hasta el borde (`fuera`, un
dedo) o bien se queda `e` más adentro (un hueco donde entra el dedo de la pieza
vecina).

Dos piezas que comparten una arista usan el **mismo reparto** (`tramos_alternos`
con la misma longitud y el mismo número de dedos) y paridad contraria: lo que
en una es dedo en la otra es hueco. Por eso encajan por construcción.
"""

from __future__ import annotations

from typing import Sequence

from build123d import Face

from .base import Punto, cara_poligono

#: (desde, hasta, fuera)
Tramo = tuple[float, float, bool]


def numero_dedos(longitud: float, ancho_dedo: float) -> int:
    """Cantidad impar de tramos (mínimo 3) que más se acerca al ancho de dedo pedido."""
    n = max(3, round(longitud / ancho_dedo))
    if n % 2 == 0:
        # entre los dos impares vecinos, el que deja el dedo más cerca del pedido
        menor, mayor = n - 1, n + 1
        n = menor if abs(longitud / menor - ancho_dedo) <= abs(longitud / mayor - ancho_dedo) and menor >= 3 else mayor
    return n


def tramos_alternos(desde: float, hasta: float, n: int, fuera_pares: bool) -> list[Tramo]:
    """`n` tramos iguales entre `desde` y `hasta`; los pares (0, 2, …) son dedos si `fuera_pares`."""
    paso = (hasta - desde) / n
    return [
        (desde + i * paso, hasta if i == n - 1 else desde + (i + 1) * paso, (i % 2 == 0) == fuera_pares)
        for i in range(n)
    ]


def _puntos(tramos: Sequence[Tramo], e: float) -> list[Punto]:
    """Puntos (posición a lo largo del lado, profundidad desde el borde)."""
    pts: list[Punto] = []
    for t0, t1, fuera in tramos:
        d = 0.0 if fuera else e
        pts.append((t0, d))
        pts.append((t1, d))
    return pts


def contorno_dentado(
    ancho: float,
    alto: float,
    e: float,
    *,
    abajo: Sequence[Tramo],
    derecha: Sequence[Tramo],
    arriba: Sequence[Tramo],
    izquierda: Sequence[Tramo],
    esquinas_ajenas: Sequence[str] = (),
) -> Face:
    """
    Cara de una pieza dentada.

    Los tramos de cada lado van en sentido creciente (`abajo`/`arriba` en X,
    `derecha`/`izquierda` en Y) y pueden no cubrir todo el lado.

    `esquinas_ajenas` nombra las esquinas (`"abajo_izq"`, `"abajo_der"`,
    `"arriba_der"`, `"arriba_izq"`) cuyo cuadrado `e × e` pertenece a otra
    pieza: ahí el contorno pasa por el vértice interior de ese cuadrado.
    """
    A, B = ancho, alto
    pts: list[Punto] = []
    pts += [(t, d) for t, d in _puntos(abajo, e)]
    if "abajo_der" in esquinas_ajenas:
        pts.append((A - e, e))
    pts += [(A - d, t) for t, d in _puntos(derecha, e)]
    if "arriba_der" in esquinas_ajenas:
        pts.append((A - e, B - e))
    pts += [(t, B - d) for t, d in reversed(_puntos(arriba, e))]
    if "arriba_izq" in esquinas_ajenas:
        pts.append((e, B - e))
    pts += [(d, t) for t, d in reversed(_puntos(izquierda, e))]
    if "abajo_izq" in esquinas_ajenas:
        pts.append((e, e))
    return cara_poligono(pts)
