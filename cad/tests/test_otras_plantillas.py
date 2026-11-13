"""Alzador y porta afiche: mismas garantías que la caja."""

from __future__ import annotations

import pytest

from motor.exportar import acomodar, exportar_dxf, exportar_glb, exportar_step, leer_json_glb
from motor.plantillas import listar, obtener
from motor.plantillas.base import ErrorParametros
from motor.validacion import interferencias, validar

from conftest import caja_de, entidades_en, leer_dxf

CASOS = [
    ("alzador", {}, {"tapa": 1, "pata": 2}),
    ("alzador", {"largo": 400, "ancho": 150, "alto": 120, "espesor": 6}, {"tapa": 1, "pata": 2}),
    ("alzador", {"retiro_patas": 25, "espesor": 3}, {"tapa": 1, "pata": 2}),
    ("alzador", {"largo": 60, "ancho": 20, "alto": 30, "espesor": 8, "retiro_patas": 5}, {"tapa": 1, "pata": 2}),
    ("porta_afiche", {}, {"base": 1, "panel": 1}),
    ("porta_afiche", {"tipo_base": "T"}, {"base": 1, "panel": 1}),
    ("porta_afiche", {"ancho": 297, "alto": 420, "fondo": 120, "espesor": 5, "tipo_base": "T"}, {"base": 1, "panel": 1}),
    ("porta_afiche", {"ancho": 100, "alto": 150, "fondo": 45, "espesor": 2, "tipo_base": "L"}, {"base": 1, "panel": 1}),
]


@pytest.fixture(params=CASOS, ids=lambda c: f"{c[0]}-{'-'.join(f'{k}{v}' for k, v in c[1].items()) or 'defecto'}")
def otro(request):
    codigo, parametros, piezas = request.param
    plantilla = obtener(codigo)
    return plantilla, plantilla.disenar(parametros), piezas


def test_medidas_piezas_e_interferencias(otro):
    plantilla, diseno, piezas = otro
    pedido = plantilla.dimensiones_esperadas(diseno.parametros)
    real = diseno.dimensiones()
    assert (real["x"], real["y"], real["z"]) == pytest.approx(pedido, abs=0.01)
    assert {p["id"]: p["cantidad"] for p in diseno.despiece()} == piezas
    assert interferencias(diseno) == []
    assert [v for v in validar(diseno) if v["nivel"] == "error"] == []
    assert diseno.caja[0][2] == pytest.approx(0, abs=0.01)  # apoyado en z = 0


def test_las_piezas_se_tocan(otro):
    """Nada queda flotando: fundidas, todas las piezas forman un solo sólido."""
    _, diseno, _ = otro
    union = diseno.instancias[0].solido
    for inst in diseno.instancias[1:]:
        union = union.fuse(inst.solido)
    assert len(union.solids()) == 1
    assert union.volume == pytest.approx(sum(i.solido.volume for i in diseno.instancias), rel=1e-6)


def test_exportaciones(otro):
    _, diseno, _ = otro
    doc = leer_dxf(exportar_dxf(diseno))
    assert doc.dxfversion == "AC1009" and doc.header["$INSUNITS"] == 4
    assert {e.dxf.layer for e in doc.modelspace()} == {"CORTE"}
    despiece = {p["id"]: p for p in diseno.despiece()}
    for c in acomodar(diseno):
        x0, y0, x1, y1 = caja_de(entidades_en(doc, c.rect))
        assert (x1 - x0, y1 - y0) == pytest.approx(
            (despiece[c.pieza.id]["ancho_mm"], despiece[c.pieza.id]["alto_mm"]), abs=0.001
        )
    glb = exportar_glb(diseno)
    assert glb[:4] == b"glTF"
    assert [n["name"] for n in leer_json_glb(glb)["nodes"]] == [i.nombre for i in diseno.instancias]
    assert exportar_step(diseno).startswith(b"ISO-10303-21")


def test_posicion_del_panel():
    for tipo, y_esperada in (("L", 40 - 3), ("T", -1.5)):
        diseno = obtener("porta_afiche").disenar({"tipo_base": tipo})
        panel = next(i for i in diseno.instancias if i.nombre == "panel").solido.bounding_box()
        assert panel.min.Y == pytest.approx(y_esperada, abs=0.01)
        assert panel.size.Y == pytest.approx(3, abs=0.01)
        assert (panel.min.Z, panel.max.Z) == pytest.approx((3, 300), abs=0.01)


def test_retiro_de_las_patas():
    diseno = obtener("alzador").disenar({"retiro_patas": 30})
    patas = [i.solido.bounding_box() for i in diseno.instancias if i.pieza.id == "pata"]
    assert sorted(round(b.min.X, 3) for b in patas) == [-95, 91]
    assert all(b.max.Z == pytest.approx(76, abs=0.01) for b in patas)


@pytest.mark.parametrize(
    "codigo, parametros, campo",
    [
        ("alzador", {"alto": 10, "espesor": 5}, "alto"),
        ("alzador", {"largo": 100, "retiro_patas": 45}, "retiro_patas"),
        ("porta_afiche", {"fondo": 10, "espesor": 5}, "fondo"),
        ("porta_afiche", {"tipo_base": "X"}, "tipo_base"),
    ],
)
def test_parametros_invalidos(codigo, parametros, campo):
    with pytest.raises(ErrorParametros) as error:
        obtener(codigo).disenar(parametros)
    assert campo in [e["campo"] for e in error.value.errores]


def test_estan_registradas():
    assert {"caja", "alzador", "porta_afiche"} <= {p.codigo for p in listar()}
