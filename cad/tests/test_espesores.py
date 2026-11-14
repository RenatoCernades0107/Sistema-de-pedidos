"""Espesor propio de una copia de pieza: `"espesor@<nodo>": mm` en los parámetros."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from motor.api import app
from motor.exportar import (
    ErrorAcomodo,
    PiezaEnPlancha,
    PlanchaAcomodada,
    exportar_dxf_planchas,
    exportar_glb,
    leer_json_glb,
    validar_planchas,
)
from motor.plantillas import listar, obtener
from motor.plantillas.base import ErrorParametros
from motor.validacion import interferencias, validar

from conftest import leer_dxf

cliente = TestClient(app, raise_server_exceptions=False)
CAJA = {"largo": 200, "ancho": 150, "alto": 100, "espesor": 3, "tipo_union": "a_tope"}


def caja(**extra):
    return obtener("caja").disenar({**CAJA, **extra})


def por_id(diseno):
    return {p.id: p for p in diseno.piezas}


def caja_de(diseno, nodo):
    inst = next(i for i in diseno.instancias if i.nombre == nodo)
    return inst.solido.bounding_box()


def test_separa_la_copia_con_espesor_propio():
    d = caja(**{"espesor@lateral_2": 5})
    piezas = por_id(d)
    assert piezas["lateral"].espesor_mm == 3 and piezas["lateral"].nombres_nodo() == ["lateral_1"]
    separada = piezas["lateral__5mm"]
    assert separada.espesor_mm == 5 and separada.nombres_nodo() == ["lateral_2"]
    assert separada.origen == "lateral" and separada.nombre == "Lateral (5 mm)"
    # La separada va justo después de la original.
    ids = [p.id for p in d.piezas]
    assert ids.index("lateral__5mm") == ids.index("lateral") + 1
    assert d.parametros_normalizados()["espesor@lateral_2"] == 5
    despiece = {p["id"]: p for p in d.despiece()}
    assert despiece["lateral__5mm"]["nodos"] == ["lateral_2"]
    assert despiece["lateral__5mm"]["origen"] == "lateral"
    assert despiece["base"]["nodos"] == ["base"] and despiece["base"]["origen"] == "base"


def test_los_nodos_del_glb_no_cambian():
    d = caja(**{"espesor@lateral_2": 5})
    gltf = leer_json_glb(exportar_glb(d))
    nodos = {n["name"]: n["extras"] for n in gltf["nodes"]}
    assert set(nodos) == {"base", "frente_1", "frente_2", "lateral_1", "lateral_2"}
    assert nodos["lateral_2"] == {"pieza": "lateral__5mm", "origen": "lateral", "nodo": "lateral_2", "espesor_mm": 5}
    assert nodos["lateral_1"]["pieza"] == "lateral"


def test_una_sola_copia_cambia_en_su_sitio_y_crece_hacia_fuera():
    d = caja(**{"espesor@base": 6})
    base = por_id(d)["base"]
    assert base.espesor_mm == 6 and base.nombre == "Base (6 mm)"
    bb = caja_de(d, "base")
    # El piso interior se queda en z = 3: la base crece hacia abajo.
    assert bb.max.Z == pytest.approx(3) and bb.min.Z == pytest.approx(-3)
    assert interferencias(d) == []


@pytest.mark.parametrize("union", ["a_tope", "encastre"])
def test_los_laterales_crecen_hacia_fuera_sin_pisarse(union):
    d = caja(tipo_union=union, **{"espesor@lateral_1": 5, "espesor@lateral_2": 5})
    assert d.dimensiones()["x"] == pytest.approx(204)
    assert interferencias(d) == []
    # Las dos copias quedan en la misma pieza: no hay nada que separar.
    assert por_id(d)["lateral"].espesor_mm == 5 and "lateral__5mm" not in por_id(d)


def test_el_aviso_y_las_medidas():
    d = caja(**{"espesor@lateral_2": 5})
    codigos = {v["codigo"]: v for v in validar(d)}
    assert codigos["espesor_cambiado"]["nivel"] == "aviso"
    assert codigos["espesor_cambiado"]["pieza"] == "lateral__5mm"
    # El conjunto ya no mide lo pedido, pero a propósito: es aviso, no error.
    assert codigos["dimensiones_no_coinciden"]["nivel"] == "aviso"
    assert not [v for v in validar(d) if v["nivel"] == "error"]


def test_se_descartan_los_nodos_que_no_existen_y_los_iguales_al_base():
    d = caja(**{"espesor@tapa": 5, "espesor@lateral_1": 3, "espesor@lateral_2": 3.0})
    assert d.espesores == {}
    assert not [k for k in d.parametros_normalizados() if k.startswith("espesor@")]
    assert [p.id for p in d.piezas] == [p.id for p in caja().piezas]


def test_cambiar_el_espesor_global_conserva_los_propios():
    d = caja(espesor=4, **{"espesor@lateral_2": 5})
    assert por_id(d)["lateral"].espesor_mm == 4 and por_id(d)["lateral__5mm"].espesor_mm == 5
    # Si el global pasa a ser el mismo, el propio sobra.
    assert caja(espesor=5, **{"espesor@lateral_2": 5}).espesores == {}


def test_espesor_decimal_en_el_id():
    d = caja(**{"espesor@lateral_2": 5.5})
    assert "lateral__5_5mm" in por_id(d)


@pytest.mark.parametrize(
    "clave,valor",
    [
        ("espesor@lateral_2", 0),
        ("espesor@lateral_2", 31),
        ("espesor@lateral_2", "5"),
        ("espesor@lateral_2", True),
        ("espesor@Lateral 2", 5),
        ("espesor@", 5),
    ],
)
def test_valores_no_validos(clave, valor):
    with pytest.raises(ErrorParametros) as e:
        caja(**{clave: valor})
    assert e.value.errores[0]["campo"] == clave


def test_api_generar_y_422():
    r = cliente.post("/generar", json={"plantilla": "caja", "parametros": {**CAJA, "espesor@lateral_2": 5}})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["parametros"]["espesor@lateral_2"] == 5
    assert {p["id"] for p in d["piezas"]} >= {"lateral", "lateral__5mm"}

    r = cliente.post("/generar", json={"plantilla": "caja", "parametros": {**CAJA, "espesor@lateral_2": 50}})
    assert r.status_code == 422
    assert r.json()["detail"]["errores"][0]["campo"] == "espesor@lateral_2"


@pytest.mark.parametrize("plantilla", [p.codigo for p in listar()])
def test_todas_las_plantillas_aceptan_un_espesor_propio(plantilla):
    """En cada plantilla, la última copia de la pieza más repetida pasa a 6 mm."""
    pl = obtener(plantilla)
    original = pl.disenar({})
    pieza = max(original.piezas, key=lambda p: p.cantidad)
    nodo = pieza.nombres_nodo()[-1]
    nuevo = 6 if pieza.espesor_mm != 6 else 4
    d = pl.disenar({f"espesor@{nodo}": nuevo})
    assert d.espesores == {nodo: nuevo}
    inst = next(i for i in d.instancias if i.nombre == nodo)
    assert inst.pieza.espesor_mm == nuevo and inst.solido.is_valid
    assert sorted(i.nombre for i in d.instancias) == sorted(i.nombre for i in original.instancias)


# --- DXF por plancha ----------------------------------------------------------


def test_una_plancha_no_mezcla_espesores():
    d = caja(**{"espesor@lateral_2": 5})
    plancha = PlanchaAcomodada(1220, 1830, [PiezaEnPlancha("lateral", 1, 0, 0), PiezaEnPlancha("lateral__5mm", 1, 0, 200)])
    with pytest.raises(ErrorAcomodo) as e:
        validar_planchas(d, [plancha], parcial=True)
    assert any("mezcla" in x["mensaje"] for x in e.value.errores)


def test_parcial_acepta_un_solo_grupo_con_rotulo():
    d = caja(**{"espesor@lateral_2": 5})
    planchas = [PlanchaAcomodada(1220, 1830, [PiezaEnPlancha("lateral__5mm", 1, 0, 0)], etiqueta="Cristal 5 mm")]
    with pytest.raises(ErrorAcomodo):
        validar_planchas(d, planchas)
    doc = leer_dxf(exportar_dxf_planchas(d, planchas, parcial=True))
    textos = [e.dxf.text for e in doc.modelspace() if e.dxftype() == "TEXT"]
    assert textos == ["Plancha 1 - Cristal 5 mm"]


def test_api_dxf_planchas_parcial():
    cuerpo = {
        "plantilla": "caja",
        "parametros": {**CAJA, "espesor@lateral_2": 5},
        "planchas": [{"ancho_mm": 1220, "alto_mm": 1830, "piezas": [{"id": "lateral__5mm", "indice": 1, "x_mm": 0, "y_mm": 0}]}],
    }
    assert cliente.post("/dxf/planchas", json=cuerpo).status_code == 422
    r = cliente.post("/dxf/planchas", json={**cuerpo, "opciones": {"parcial": True}})
    assert r.status_code == 200, r.text
