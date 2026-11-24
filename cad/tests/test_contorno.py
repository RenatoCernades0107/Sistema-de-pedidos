"""El despiece manda el contorno real de cada pieza, para dibujarlo en las planchas."""

from __future__ import annotations

import math
import re

from build123d import Edge, Face, Location, Wire

from motor.plantillas import obtener
from motor.plantillas.base import Pieza, cara_rectangulo, con_agujeros, contorno_svg


def _trazos(d: str) -> list[list[tuple[float, float]]]:
    """Los puntos de cada subtrazo `M… Z`."""
    salida = []
    for trazo in re.findall(r"M([^MZ]+)Z", d):
        n = [float(v) for v in trazo.split()]
        salida.append(list(zip(n[0::2], n[1::2])))
    return salida


def _disco(radio: float) -> Face:
    return Face(Wire([Edge.make_circle(radio).moved(Location((radio, radio, 0)))]))


def test_un_disco_sale_redondo_y_en_su_caja():
    (puntos,) = _trazos(contorno_svg(_disco(750)))
    assert len(puntos) > 100
    xs, ys = [p[0] for p in puntos], [p[1] for p in puntos]
    assert min(xs) == 0 and min(ys) == 0
    assert math.isclose(max(xs), 1500, abs_tol=0.1) and math.isclose(max(ys), 1500, abs_tol=0.1)
    # Todos los puntos sobre la circunferencia: es un círculo, no su caja.
    assert all(math.isclose(math.hypot(x - 750, y - 750), 750, abs_tol=0.1) for x, y in puntos)


def test_rectangulo_con_agujeros_y_la_y_hacia_abajo():
    hueco = Wire.make_polygon([(10, 30, 0), (20, 30, 0), (20, 40, 0), (10, 40, 0)], close=True)
    d = contorno_svg(con_agujeros(cara_rectangulo(100, 50), [hueco]))
    exterior, agujero = _trazos(d)
    assert sorted(exterior) == [(0, 0), (0, 50), (100, 0), (100, 50)]
    # y' = 50 − y: el agujero de y 30..40 queda en 10..20.
    assert sorted(agujero) == [(10, 10), (10, 20), (20, 10), (20, 20)]


def test_el_despiece_lo_incluye():
    diseno = obtener("caja").disenar({})
    for p in diseno.despiece():
        assert p["contorno"].startswith("M") and p["contorno"].endswith("Z")
    pieza = Pieza("disco", "Disco", _disco(100), 3)
    assert _trazos(contorno_svg(pieza.contorno))
