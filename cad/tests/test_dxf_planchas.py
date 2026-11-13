"""DXF por plancha: cada pieza en el sitio que dice el acomodo, dentro de su plancha."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from motor.api import app
from motor.exportar import (
    ErrorAcomodo,
    PiezaEnPlancha,
    PlanchaAcomodada,
    exportar_dxf_planchas,
    validar_planchas,
)

from conftest import caja_de, disenar_caja, entidades_en, leer_dxf

cliente = TestClient(app, raise_server_exceptions=False)
PARAMETROS = {"largo": 200, "ancho": 150, "alto": 100, "espesor": 3, "tipo_union": "a_tope"}


def en_filas(diseno, ancho_plancha=1220.0, alto_plancha=1830.0, rotar=False, sep=10.0):
    """Un acomodo simple: una copia tras otra en una columna, en planchas de 2 piezas."""
    planchas: list[PlanchaAcomodada] = []
    for pz in diseno.despiece():
        for indice in range(1, pz["cantidad"] + 1):
            if not planchas or len(planchas[-1].piezas) == 2:
                planchas.append(PlanchaAcomodada(ancho_plancha, alto_plancha, []))
            y = 0.0 if not planchas[-1].piezas else 600.0
            planchas[-1].piezas.append(PiezaEnPlancha(pz["id"], indice, sep, y + sep, rotar))
    return planchas


def test_cada_pieza_en_su_sitio_y_planchas_separadas():
    diseno = disenar_caja(PARAMETROS)
    planchas = en_filas(diseno)
    doc = leer_dxf(exportar_dxf_planchas(diseno, planchas))
    capas = {c.dxf.name: c.dxf.color for c in doc.layers}
    assert capas["PLANCHA"] == 8 and capas["CORTE"] == 1 and capas["GRABADO"] == 3

    marcos = [e for e in doc.modelspace() if e.dxf.layer == "PLANCHA"]
    assert len(marcos) == 4 * len(planchas)
    despiece = {pz["id"]: pz for pz in diseno.despiece()}
    for i, plancha in enumerate(planchas):
        ox = i * (1220.0 + 50.0)
        for pp in plancha.piezas:
            pz = despiece[pp.id]
            rect = (ox + pp.x_mm, pp.y_mm, ox + pp.x_mm + pz["ancho_mm"], pp.y_mm + pz["alto_mm"])
            corte = [e for e in entidades_en(doc, rect) if e.dxf.layer == "CORTE"]
            assert corte
            x0, y0, x1, y1 = caja_de(corte)
            assert (x0, y0) == pytest.approx((rect[0], rect[1]), abs=1e-3)
            assert (x1, y1) == pytest.approx((rect[2], rect[3]), abs=1e-3)


def test_rotada_intercambia_ancho_y_alto():
    diseno = disenar_caja(PARAMETROS)
    planchas = en_filas(diseno, rotar=True)
    doc = leer_dxf(exportar_dxf_planchas(diseno, planchas, kerf_mm=0.2))
    pp = planchas[0].piezas[0]
    pz = next(p for p in diseno.despiece() if p["id"] == pp.id)
    rect = (pp.x_mm - 0.2, pp.y_mm - 0.2, pp.x_mm + pz["alto_mm"] + 0.2, pp.y_mm + pz["ancho_mm"] + 0.2)
    corte = [e for e in entidades_en(doc, rect) if e.dxf.layer == "CORTE"]
    x0, y0, x1, y1 = caja_de(corte)
    # con kerf, el contorno exterior crece medio kerf por lado
    assert x1 - x0 == pytest.approx(pz["alto_mm"] + 0.2, abs=1e-3)
    assert y1 - y0 == pytest.approx(pz["ancho_mm"] + 0.2, abs=1e-3)


def test_valida_faltantes_repetidas_y_fuera():
    diseno = disenar_caja(PARAMETROS)
    planchas = en_filas(diseno)
    falta = [PlanchaAcomodada(p.ancho_mm, p.alto_mm, list(p.piezas)) for p in planchas]
    falta[-1].piezas.pop()
    with pytest.raises(ErrorAcomodo, match="no es válido") as e:
        validar_planchas(diseno, falta)
    assert any("Falta colocar" in x["mensaje"] for x in e.value.errores)

    repetida = en_filas(diseno)
    repetida[0].piezas.append(repetida[0].piezas[0])
    with pytest.raises(ErrorAcomodo) as e:
        validar_planchas(diseno, repetida)
    assert any("repetida" in x["mensaje"] for x in e.value.errores)

    fuera = en_filas(diseno, ancho_plancha=100.0)
    with pytest.raises(ErrorAcomodo) as e:
        validar_planchas(diseno, fuera)
    assert any("se sale" in x["mensaje"] for x in e.value.errores)


def _cuerpo(planchas):
    return {
        "plantilla": "caja",
        "parametros": PARAMETROS,
        "opciones": {"kerf_mm": 0.1},
        "planchas": [
            {
                "ancho_mm": p.ancho_mm,
                "alto_mm": p.alto_mm,
                "piezas": [
                    {"id": x.id, "indice": x.indice, "x_mm": x.x_mm, "y_mm": x.y_mm, "rotada": x.rotada}
                    for x in p.piezas
                ],
            }
            for p in planchas
        ],
    }


def test_api_dxf_planchas(sin_clave):
    planchas = en_filas(disenar_caja(PARAMETROS))
    r = cliente.post("/dxf/planchas", json=_cuerpo(planchas))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/dxf")
    doc = leer_dxf(r.content)
    assert {e.dxf.layer for e in doc.modelspace()} == {"PLANCHA", "CORTE"}


def test_api_dxf_planchas_422(sin_clave):
    planchas = en_filas(disenar_caja(PARAMETROS))
    planchas[0].piezas.pop()
    r = cliente.post("/dxf/planchas", json=_cuerpo(planchas))
    assert r.status_code == 422
    assert r.json()["detail"]["codigo"] == "acomodo_invalido"
    assert r.json()["detail"]["errores"]

    vacio = cliente.post("/dxf/planchas", json={"plantilla": "caja", "planchas": []})
    assert vacio.status_code == 422
    assert vacio.json()["detail"]["codigo"] == "parametros_invalidos"
