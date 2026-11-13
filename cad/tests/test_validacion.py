"""Las comprobaciones detectan lo que deben."""

from __future__ import annotations

from build123d import Location
from pydantic import Field

from motor.plantillas import obtener
from motor.plantillas.base import Parametros, Pieza, Plantilla, cara_rectangulo
from motor.validacion import plancha_maxima, validar


class _P(Parametros):
    lado: float = Field(100, title="Lado", description="Lado en mm.", ge=1, le=5000)


def _plantilla(construir, esperadas=None):
    return Plantilla("prueba", "Prueba", "cajas", 1, "De prueba.", _P, construir, esperadas)


def _codigos(validaciones, nivel=None):
    return {v["codigo"] for v in validaciones if nivel is None or v["nivel"] == nivel}


def test_detecta_interferencia():
    def construir(p):
        cara = cara_rectangulo(p.lado, p.lado)
        return [
            Pieza("a", "A", cara, 3),
            Pieza("b", "B", cara, 3, [Location((p.lado / 2, 0, 1.5))]),
        ]

    v = validar(_plantilla(construir).disenar({}))
    assert "interferencia" in _codigos(v, "error")


def test_piezas_que_solo_se_tocan_no_interfieren():
    def construir(p):
        cara = cara_rectangulo(p.lado, p.lado)
        return [Pieza("a", "A", cara, 3, [Location((0, 0, 0)), Location((0, 0, 3)), Location((p.lado, 0, 0))])]

    assert validar(_plantilla(construir).disenar({})) == []


def test_detecta_pieza_mayor_que_la_plancha(monkeypatch):
    def construir(p):
        return [Pieza("a", "A", cara_rectangulo(p.lado, 500), 3)]

    plantilla = _plantilla(construir)
    assert "excede_plancha" in _codigos(validar(plantilla.disenar({"lado": 2500})), "error")
    assert "excede_plancha" not in _codigos(validar(plantilla.disenar({"lado": 2400})))
    # girada también entra: 1300 × 500 cabe en 2440 × 1220
    assert "excede_plancha" not in _codigos(validar(plantilla.disenar({"lado": 1300})))
    monkeypatch.setenv("CAD_PLANCHA_MAX_MM", "1200x600")
    assert plancha_maxima() == (1200, 600)
    assert "excede_plancha" in _codigos(validar(plantilla.disenar({"lado": 1300})), "error")


def test_avisa_de_pieza_angosta():
    def construir(p):
        return [Pieza("tira", "Tira", cara_rectangulo(p.lado, 5), 3)]

    v = validar(_plantilla(construir).disenar({}))
    assert [(x["nivel"], x["codigo"], x["pieza"]) for x in v] == [("aviso", "pared_delgada", "tira")]


def test_detecta_medidas_que_no_coinciden():
    def construir(p):
        return [Pieza("a", "A", cara_rectangulo(p.lado, p.lado), 3)]

    mal = _plantilla(construir, lambda p: (p.lado, p.lado, 10))
    bien = _plantilla(construir, lambda p: (p.lado, p.lado, 3))
    assert "dimensiones_no_coinciden" in _codigos(validar(mal.disenar({})), "error")
    assert validar(bien.disenar({})) == []


def test_aviso_de_dedo_angosto_en_la_caja():
    v = validar(obtener("caja").disenar({"tipo_union": "encastre", "espesor": 8, "ancho_dedo": 4}))
    assert _codigos(v) == {"dedo_angosto"}
    assert all(x["nivel"] == "aviso" for x in v)
