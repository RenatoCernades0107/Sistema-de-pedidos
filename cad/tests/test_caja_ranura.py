"""Caja con ranura (alcancía, sugerencias, sorteo): en la tapa o en el frente."""

from __future__ import annotations

from collections import Counter

import pytest

from motor.exportar import exportar_dxf
from motor.plantillas import obtener
from motor.plantillas.base import ErrorParametros
from motor.validacion import interferencias, validar

from conftest import leer_dxf


def _disenar(**p):
    return obtener("caja").disenar(p)


def _tipos(diseno) -> Counter:
    doc = leer_dxf(exportar_dxf(diseno))
    return Counter(e.dxftype() for e in doc.modelspace() if e.dxf.layer == "CORTE")


@pytest.mark.parametrize("union", ["a_tope", "encastre"])
def test_ranura_en_tapa_simple_y_con_pestana(union):
    simple = _disenar(tipo_union=union, con_tapa=True, ranura="tapa")
    assert _tipos(simple)["ARC"] == 2
    pestana = _disenar(tipo_union=union, con_tapa=True, tipo_tapa="con_pestana", ranura="tapa")
    assert _tipos(pestana)["ARC"] == 4  # la ranura atraviesa tapa y pestaña
    for d in (simple, pestana):
        assert interferencias(d) == []
        assert [v for v in validar(d) if v["nivel"] == "error"] == []
        assert d.dimensiones() == pytest.approx({"x": 200, "y": 150, "z": 100}, abs=1e-3)


@pytest.mark.parametrize("union", ["a_tope", "encastre"])
def test_ranura_en_frente_separa_frente_y_fondo(union):
    d = _disenar(tipo_union=union, ranura="frente", largo_ranura=80, ancho_ranura=8)
    ids = {p.id: len(p.ubicaciones) for p in d.piezas}
    assert ids["frente"] == 1 and ids["fondo"] == 1
    assert _tipos(d)["ARC"] == 2
    assert interferencias(d) == []
    # el área del frente es la del fondo menos la ranura
    frente = next(p for p in d.piezas if p.id == "frente").contorno.area
    fondo = next(p for p in d.piezas if p.id == "fondo").contorno.area
    import math

    hueco = (80 - 8) * 8 + math.pi * 4**2
    assert fondo - frente == pytest.approx(hueco, rel=1e-4)


def test_sin_ranura_no_cambia():
    d = _disenar()
    assert {p.id for p in d.piezas} == {"base", "frente", "lateral"}
    assert _tipos(d)["ARC"] == 0


def test_errores_de_ranura():
    with pytest.raises(ErrorParametros) as sin_tapa:
        _disenar(ranura="tapa")
    assert "ranura" in str(sin_tapa.value.errores)
    with pytest.raises(ErrorParametros):
        _disenar(con_tapa=True, ranura="tapa", largo_ranura=500)
    with pytest.raises(ErrorParametros):
        _disenar(ranura="frente", ancho_ranura=90)
    with pytest.raises(ErrorParametros):
        _disenar(con_tapa=True, ranura="tapa", largo_ranura=20, ancho_ranura=30)
