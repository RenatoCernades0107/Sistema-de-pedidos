"""
Ánfora, display, atril, tareco, letrero y letras: mismas garantías que la caja.

Para cada plantilla, una rejilla de parámetros: lo armado mide lo prometido,
nada se pisa, los sólidos son válidos, nada queda flotando, el DXF tiene los
contornos cerrados en sus capas y las curvas redondas salen como ARC/CIRCLE.
"""

from __future__ import annotations

import base64
import itertools
import math
from collections import Counter
from functools import lru_cache

import pytest
from fastapi.testclient import TestClient

from motor.api import app
from motor.exportar import acomodar, exportar_dxf, exportar_glb, exportar_step, leer_json_glb
from motor.plantillas import listar, obtener
from motor.plantillas.base import ErrorParametros
from motor.validacion import interferencias, validar

from conftest import caja_de, entidades_en, leer_dxf


def _rejilla(**ejes) -> list[dict]:
    claves = list(ejes)
    return [dict(zip(claves, valores)) for valores in itertools.product(*ejes.values())]


CASOS: list[tuple[str, dict]] = (
    [("anfora", p) for p in _rejilla(
        espesor=(3, 5),
        tapa_desmontable=(False, True),
        con_cerradura=(False, True),
        largo=(250, 400),
    )]
    + [("anfora", {"largo": 300, "ancho": 200, "alto": 200, "largo_ranura": 120, "ancho_ranura": 8})]
    + [("display", p) for p in _rejilla(niveles=(1, 3, 5), con_ceja=(False, True), espesor=(3, 5))]
    + [("display", {"ancho": 400, "fondo": 250, "alto": 250, "niveles": 4, "con_ceja": True, "alto_ceja": 20})]
    + [("atril", p) for p in _rejilla(angulo=(45, 65, 80), con_ceja=(False, True), con_base=(False, True))]
    + [("atril", {"ancho": 300, "alto": 420, "espesor": 4, "alto_frente": 40})]
    + [("tareco", p) for p in _rejilla(angulo=(50, 65, 80), con_base=(False, True), espesor=(2, 3))]
    + [("tareco", {"largo": 300, "alto": 105})]
    + [("letrero", p) for p in _rejilla(
        agujeros=("0", "2", "4"),
        doble_capa=(False, True),
        radio_esquinas=(0, 10),
    )]
    + [("letrero", {"ancho": 500, "alto": 500, "espesor": 5, "texto": "Baños", "alto_texto": 80})]
    + [("letrero", {"texto": ""})]
    + [("letras", p) for p in _rejilla(texto=("PLEXI", "Año 2026"), con_placa=(False, True))]
    + [("letras", {"texto": "ABO", "alto_letra": 300, "espesor": 10, "con_placa": True, "margen_placa": 0})]
)


def _id(caso) -> str:
    codigo, p = caso
    return f"{codigo}-" + ("-".join(f"{k}{v}" for k, v in p.items()) or "defecto")


@lru_cache(maxsize=None)
def _disenar(codigo: str, clave: tuple):
    return obtener(codigo).disenar(dict(clave))


@pytest.fixture(params=CASOS, ids=_id)
def caso(request):
    codigo, p = request.param
    return codigo, p, _disenar(codigo, tuple(sorted(p.items())))


# --------------------------------------------------------------------------
# Geometría del conjunto
# --------------------------------------------------------------------------


def test_medidas_exteriores(caso):
    _, _, diseno = caso
    pedido = diseno.plantilla.dimensiones_esperadas(diseno.parametros)
    real = diseno.dimensiones()
    assert (real["x"], real["y"], real["z"]) == pytest.approx(pedido, abs=0.01)
    mn, mx = diseno.caja
    assert mn[2] == pytest.approx(0, abs=0.01)  # apoyado en z = 0
    assert (mn[0] + mx[0], mn[1] + mx[1]) == pytest.approx((0, 0), abs=0.01)  # centrado en XY


def test_sin_interferencias_ni_errores(caso):
    _, _, diseno = caso
    assert interferencias(diseno) == []
    assert [v for v in validar(diseno) if v["nivel"] == "error"] == []


def test_solidos_validos(caso):
    _, _, diseno = caso
    for inst in diseno.instancias:
        assert inst.solido.is_valid, inst.nombre
        assert inst.solido.volume == pytest.approx(inst.pieza.area_mm2 * inst.pieza.espesor_mm, rel=1e-6)


def test_nada_queda_flotando(caso):
    codigo, p, diseno = caso
    if codigo == "letras" and not p.get("con_placa"):
        pytest.skip("Letras sueltas: cada una es independiente.")
    union = diseno.instancias[0].solido
    for inst in diseno.instancias[1:]:
        union = union.fuse(inst.solido)
    assert len(union.solids()) == 1
    assert union.volume == pytest.approx(sum(i.solido.volume for i in diseno.instancias), rel=1e-6)


# --------------------------------------------------------------------------
# DXF, GLB y STEP
# --------------------------------------------------------------------------


def _extremos(entidad) -> list[tuple[float, float]]:
    t = entidad.dxftype()
    if t == "LINE":
        return [tuple(entidad.dxf.start)[:2], tuple(entidad.dxf.end)[:2]]
    if t == "ARC":
        c, r = entidad.dxf.center, entidad.dxf.radius
        return [
            (c[0] + r * math.cos(math.radians(a)), c[1] + r * math.sin(math.radians(a)))
            for a in (entidad.dxf.start_angle, entidad.dxf.end_angle)
        ]
    return []  # CIRCLE: cerrado por sí mismo


def _contornos_cerrados(entidades) -> bool:
    """Cada extremo de LINE/ARC coincide con otro: los contornos cierran."""
    cuenta = Counter((round(x, 3) + 0.0, round(y, 3) + 0.0) for e in entidades for x, y in _extremos(e))
    return all(n % 2 == 0 for n in cuenta.values())


def test_dxf(caso):
    codigo, p, diseno = caso
    doc = leer_dxf(exportar_dxf(diseno))
    assert doc.dxfversion == "AC1009" and doc.header["$INSUNITS"] == 4
    entidades = list(doc.modelspace())
    capas = {e.dxf.layer for e in entidades}
    graba = codigo == "letrero" and p.get("texto", "PLEXIACRIL").strip() != ""
    assert capas == ({"CORTE", "GRABADO"} if graba else {"CORTE"})
    assert {e.dxftype() for e in entidades} <= {"LINE", "ARC", "CIRCLE"}
    corte = [e for e in entidades if e.dxf.layer == "CORTE"]
    assert all(e.dxf.color == 1 for e in corte)
    assert all(e.dxf.color == 3 for e in entidades if e.dxf.layer == "GRABADO")
    assert _contornos_cerrados(corte)
    for pieza in diseno.piezas:
        assert pieza.contorno.outer_wire().is_closed
        assert all(w.is_closed for w in pieza.contorno.inner_wires())
    despiece = {d["id"]: d for d in diseno.despiece()}
    for c in acomodar(diseno):
        dentro = [e for e in entidades_en(doc, c.rect) if e.dxf.layer == "CORTE"]
        x0, y0, x1, y1 = caja_de(dentro)
        assert (x1 - x0, y1 - y0) == pytest.approx(
            (despiece[c.pieza.id]["ancho_mm"], despiece[c.pieza.id]["alto_mm"]), abs=0.01
        )


def test_glb_y_step(caso):
    _, _, diseno = caso
    glb = exportar_glb(diseno)
    assert glb[:4] == b"glTF"
    assert [n["name"] for n in leer_json_glb(glb)["nodes"]] == [i.nombre for i in diseno.instancias]
    assert exportar_step(diseno).startswith(b"ISO-10303-21")


def _tipos(diseno) -> Counter:
    return Counter(e.dxftype() for e in leer_dxf(exportar_dxf(diseno)).modelspace() if e.dxf.layer == "CORTE")


def test_curvas_reales_del_anfora():
    sin = _tipos(obtener("anfora").disenar({}))
    assert sin["ARC"] == 2 and sin["CIRCLE"] == 0  # las dos puntas de la ranura
    con = _tipos(obtener("anfora").disenar({"con_cerradura": True, "tapa_desmontable": True}))
    assert con["ARC"] == 4 and con["CIRCLE"] == 1  # ranura en tapa y pestaña, y la cerradura


def test_curvas_reales_del_letrero():
    t = _tipos(obtener("letrero").disenar({"agujeros": "4", "radio_esquinas": 10, "doble_capa": True}))
    assert t["ARC"] == 8 and t["CIRCLE"] == 8
    t = _tipos(obtener("letrero").disenar({"agujeros": "2", "radio_esquinas": 0}))
    assert t["ARC"] == 0 and t["CIRCLE"] == 2 and t["LINE"] == 4


# --------------------------------------------------------------------------
# Detalles de cada familia
# --------------------------------------------------------------------------


def test_piezas_del_anfora():
    cuenta = lambda q: {d["id"]: d["cantidad"] for d in obtener("anfora").disenar(q).despiece()}  # noqa: E731
    assert cuenta({}) == {"base": 1, "frente": 2, "lateral": 2, "tapa": 1}
    assert cuenta({"con_cerradura": True, "tapa_desmontable": True}) == {
        "base": 1, "frente": 1, "fondo": 1, "lateral": 2, "tapa": 1, "pestana_tapa": 1,
    }


def test_volumen_del_anfora():
    """Las paredes llenan el cascarón: base, cuatro paredes y tapa, menos la ranura."""
    L = W = H = 250
    e = 3
    d = obtener("anfora").disenar({})
    ranura = (100 - 10) * 10 + math.pi * 5**2
    esperado = L * W * H - (L - 2 * e) * (W - 2 * e) * (H - 2 * e) - ranura * e
    assert sum(i.solido.volume for i in d.instancias) == pytest.approx(esperado, rel=1e-6)


def test_gradas_del_display():
    d = obtener("display").disenar({"niveles": 3, "con_ceja": True, "alto_ceja": 10})
    estantes = sorted((i.solido.bounding_box() for i in d.instancias if i.pieza.id.startswith("estante")), key=lambda b: b.max.Z)
    assert [round(b.max.Z, 3) for b in estantes] == [pytest.approx(140 / 3 * k, abs=1e-3) for k in (1, 2, 3)]
    # cada estante empieza una grada más atrás y todos llegan al respaldo
    assert [round(b.min.Y + 75, 3) for b in estantes] == [pytest.approx(147 / 3 * k, abs=1e-3) for k in (0, 1, 2)]
    assert all(b.max.Y == pytest.approx(75 - 3, abs=1e-3) for b in estantes)
    assert {x["id"]: x["cantidad"] for x in d.despiece()}["ceja"] == 3


def test_angulo_del_atril():
    for angulo in (45, 65, 80):
        d = obtener("atril").disenar({"angulo": angulo})
        panel = next(i for i in d.instancias if i.pieza.id == "panel")
        normal = max(panel.solido.faces(), key=lambda f: f.area).normal_at()
        assert math.degrees(math.acos(abs(normal.Z))) == pytest.approx(angulo, abs=1e-6)


@pytest.mark.parametrize("codigo", ["atril", "tareco"])
def test_aviso_sin_plegado(codigo):
    v = validar(obtener(codigo).disenar({}))
    assert [x["codigo"] for x in v] == ["sin_plegado"] and v[0]["nivel"] == "aviso"


def test_tareco_dos_caras_simetricas():
    d = obtener("tareco").disenar({})
    caras = [i.solido.bounding_box() for i in d.instancias if i.pieza.id == "cara"]
    assert len(caras) == 2
    assert caras[0].min.Y == pytest.approx(-caras[1].max.Y, abs=1e-6)
    assert caras[0].max.Z == pytest.approx(100, abs=1e-6) and caras[1].max.Z == pytest.approx(100, abs=1e-6)


def test_grabado_del_letrero_dentro_de_la_placa():
    d = obtener("letrero").disenar({"texto": "SALIDA", "alto_texto": 40})
    placa = d.piezas[0]
    assert placa.grabado
    xs = [v.X for a in placa.grabado for v in a.vertices()]
    ys = [v.Y for a in placa.grabado for v in a.vertices()]
    assert min(xs) >= placa.caja_plana[0] + 12 + 5 - 1e-6 and max(xs) <= placa.caja_plana[2] - 17 + 1e-6
    assert max(ys) - min(ys) <= 40 + 1e-6
    # centrado
    assert (min(xs) + max(xs)) / 2 == pytest.approx(100, abs=0.5)


def test_letras_una_pieza_por_trazo():
    d = obtener("letras").disenar({"texto": "AB"})
    assert [p.id for p in d.piezas] == ["letra_1", "letra_2"]
    # la «A» tiene un ojo y la «B» dos
    assert [len(p.contorno.inner_wires()) for p in d.piezas] == [1, 2]
    assert d.dimensiones()["y"] == pytest.approx(100, abs=0.01)


@pytest.mark.parametrize(
    "codigo, parametros, campo",
    [
        ("anfora", {"largo_ranura": 240}, "largo_ranura"),
        ("anfora", {"alto": 60, "espesor": 10}, "alto"),
        ("anfora", {"con_cerradura": True, "diametro_cerradura": 40, "alto": 80}, "diametro_cerradura"),
        ("display", {"niveles": 10, "fondo": 60}, "niveles"),
        ("display", {"con_ceja": True, "alto_ceja": 60}, "alto_ceja"),
        ("atril", {"alto_frente": 1}, "alto_frente"),
        ("atril", {"angulo": 90}, "angulo"),
        ("tareco", {"alto": 20, "espesor": 5}, "alto"),
        ("letrero", {"radio_esquinas": 100}, "radio_esquinas"),
        ("letrero", {"margen_agujero": 3, "diametro_agujero": 5}, "margen_agujero"),
        ("letrero", {"agujeros": "3"}, "agujeros"),
        ("letrero", {"texto": "x" * 61}, "texto"),
        ("letras", {"texto": "   "}, "texto"),
        ("letras", {"texto": ""}, "texto"),
    ],
)
def test_parametros_invalidos(codigo, parametros, campo):
    with pytest.raises(ErrorParametros) as error:
        obtener(codigo).disenar(parametros)
    assert campo in [e["campo"] for e in error.value.errores]
    assert all(e["mensaje"] for e in error.value.errores)


def test_estan_registradas_con_su_familia():
    familias = {p.codigo: p.familia for p in listar()}
    assert {
        "anfora": "anforas",
        "display": "displays",
        "atril": "atriles",
        "tareco": "tarecos",
        "letrero": "letreros",
        "letras": "letras",
    }.items() <= familias.items()


# --------------------------------------------------------------------------
# Ida y vuelta por la API
# --------------------------------------------------------------------------

cliente = TestClient(app, raise_server_exceptions=False)

DE_API = [
    ("anfora", {"con_cerradura": True, "tapa_desmontable": True}),
    ("display", {"niveles": 4, "con_ceja": True}),
    ("atril", {"angulo": 70}),
    ("tareco", {"con_base": True}),
    ("letrero", {"texto": "Recepción", "doble_capa": True}),
    ("letras", {"texto": "Ñandú", "con_placa": True}),
]


@pytest.mark.parametrize("codigo, parametros", DE_API, ids=[c for c, _ in DE_API])
def test_ida_y_vuelta_por_la_api(sin_clave, codigo, parametros):
    r = cliente.get(f"/plantillas/{codigo}")
    assert r.status_code == 200
    esquema = r.json()["esquema"]
    assert set(parametros) <= set(esquema["properties"])

    r = cliente.post("/generar", json={"plantilla": codigo, "parametros": parametros})
    assert r.status_code == 200, r.text
    d = r.json()
    diseno = obtener(codigo).disenar(parametros)
    assert d["plantilla"] == codigo
    assert d["parametros"] == diseno.parametros_normalizados()
    assert d["dimensiones"] == diseno.dimensiones()
    assert [p["id"] for p in d["piezas"]] == [p.id for p in diseno.piezas]
    assert not [v for v in d["validaciones"] if v["nivel"] == "error"]
    assert base64.b64decode(d["glb_base64"])[:4] == b"glTF"

    # los parámetros normalizados vuelven a dar el mismo diseño
    r2 = cliente.post("/generar", json={"plantilla": codigo, "parametros": d["parametros"]})
    assert r2.status_code == 200 and r2.json()["dimensiones"] == d["dimensiones"]

    r = cliente.post("/dxf", json={"plantilla": codigo, "parametros": parametros})
    assert r.status_code == 200
    assert {e.dxf.layer for e in leer_dxf(r.content).modelspace()} >= {"CORTE"}
    r = cliente.post("/step", json={"plantilla": codigo, "parametros": parametros})
    assert r.status_code == 200 and r.content.startswith(b"ISO-10303-21")


def test_api_422_en_familias_nuevas(sin_clave):
    r = cliente.post("/generar", json={"plantilla": "letras", "parametros": {"texto": ""}})
    assert r.status_code == 422
    r = cliente.post("/generar", json={"plantilla": "atril", "parametros": {"angulo": 10}})
    assert r.status_code == 422
