"""Geometría de la plantilla «caja»: lo armado mide lo pedido y nada se pisa."""

from __future__ import annotations

import pytest

from motor.plantillas import obtener
from motor.plantillas.base import ErrorParametros
from motor.plantillas.dentado import numero_dedos, tramos_alternos
from motor.validacion import interferencias, validar

from conftest import disenar_caja


def test_medidas_exteriores(caso):
    p, diseno = caso
    d = diseno.dimensiones()
    assert d["x"] == pytest.approx(p["largo"], abs=0.01)
    assert d["y"] == pytest.approx(p["ancho"], abs=0.01)
    assert d["z"] == pytest.approx(p["alto"], abs=0.01)
    # centrada en XY y apoyada en z = 0
    mn, mx = diseno.caja
    assert mn[0] == pytest.approx(-p["largo"] / 2, abs=0.01)
    assert mn[1] == pytest.approx(-p["ancho"] / 2, abs=0.01)
    assert mn[2] == pytest.approx(0, abs=0.01)


def test_sin_interferencias(caso):
    _, diseno = caso
    assert interferencias(diseno) == []


def test_solidos_validos(caso):
    _, diseno = caso
    for inst in diseno.instancias:
        assert inst.solido.is_valid, inst.nombre
        assert inst.solido.volume == pytest.approx(inst.pieza.area_mm2 * inst.pieza.espesor_mm, rel=1e-6)


def test_cantidad_de_piezas(caso):
    p, diseno = caso
    esperadas = {"base": 1, "frente": 2, "lateral": 2}
    if p["con_tapa"]:
        esperadas["tapa"] = 1
        if p["tipo_tapa"] == "con_pestana":
            esperadas["pestana_tapa"] = 1
    assert {pz["id"]: pz["cantidad"] for pz in diseno.despiece()} == esperadas
    nombres = [i.nombre for i in diseno.instancias]
    assert len(nombres) == sum(esperadas.values())
    assert len(set(nombres)) == len(nombres)
    assert {"frente_1", "frente_2", "lateral_1", "lateral_2", "base"} <= set(nombres)


def test_volumen_del_cascaron(caso):
    """
    Las piezas llenan exactamente el cascarón de la caja: ni se pisan ni dejan
    huecos en las uniones. En el encastre esto prueba que los dedos de piezas
    vecinas son complementarios.
    """
    p, diseno = caso
    L, W, H, e = p["largo"], p["ancho"], p["alto"], p["espesor"]
    hp = H - e if p["con_tapa"] else H
    esperado = L * W * hp - (L - 2 * e) * (W - 2 * e) * (hp - e)
    if p["con_tapa"]:
        esperado += L * W * e
        if p["tipo_tapa"] == "con_pestana":
            m = e + 0.2
            esperado += (L - 2 * m) * (W - 2 * m) * e
    del_despiece = sum(pz["area_mm2"] * pz["cantidad"] * pz["espesor_mm"] for pz in diseno.despiece())
    assert del_despiece == pytest.approx(esperado, rel=1e-6)
    assert sum(i.solido.volume for i in diseno.instancias) == pytest.approx(esperado, rel=1e-6)


def test_despiece(caso):
    p, diseno = caso
    L, W, H, e = p["largo"], p["ancho"], p["alto"], p["espesor"]
    hp = H - e if p["con_tapa"] else H
    piezas = {pz["id"]: pz for pz in diseno.despiece()}
    assert (piezas["base"]["ancho_mm"], piezas["base"]["alto_mm"]) == (L, W)
    if p["tipo_union"] == "a_tope":
        assert (piezas["frente"]["ancho_mm"], piezas["frente"]["alto_mm"]) == pytest.approx((L, hp - e))
        assert (piezas["lateral"]["ancho_mm"], piezas["lateral"]["alto_mm"]) == pytest.approx((W - 2 * e, hp - e))
        # rectángulos: área y perímetro exactos
        assert piezas["frente"]["area_mm2"] == pytest.approx(L * (hp - e))
        assert piezas["frente"]["perimetro_mm"] == pytest.approx(2 * (L + hp - e))
    else:
        assert (piezas["frente"]["ancho_mm"], piezas["frente"]["alto_mm"]) == pytest.approx((L, hp))
        assert (piezas["lateral"]["ancho_mm"], piezas["lateral"]["alto_mm"]) == pytest.approx((W, hp))
        # los dedos quitan área y alargan el recorrido de corte
        assert piezas["frente"]["area_mm2"] < L * hp
        assert piezas["frente"]["perimetro_mm"] > 2 * (L + hp)
    for pz in piezas.values():
        assert pz["espesor_mm"] == e
        assert 0 < pz["area_mm2"] <= pz["ancho_mm"] * pz["alto_mm"] + 1e-6


def test_validaciones_sin_errores(caso):
    _, diseno = caso
    assert [v for v in validar(diseno) if v["nivel"] == "error"] == []


def test_valores_por_defecto():
    diseno = obtener("caja").disenar({})
    assert diseno.parametros_normalizados() == {
        "largo": 200,
        "ancho": 150,
        "alto": 100,
        "espesor": 3,
        "tipo_union": "a_tope",
        "ancho_dedo": 15,
        "con_tapa": False,
        "tipo_tapa": "simple",
        "holgura_tapa": 0.2,
        "ranura": "ninguna",
        "largo_ranura": 100,
        "ancho_ranura": 10,
    }
    assert diseno.dimensiones() == {"x": 200, "y": 150, "z": 100}


@pytest.mark.parametrize("ancho_dedo", [3, 8, 15, 40, 200])
def test_encastre_con_varios_anchos_de_dedo(ancho_dedo):
    diseno = disenar_caja({"tipo_union": "encastre", "ancho_dedo": ancho_dedo, "espesor": 4, "con_tapa": True})
    assert interferencias(diseno) == []
    assert diseno.dimensiones() == {"x": 200, "y": 150, "z": 100}
    esperado = 200 * 150 * 96 - 192 * 142 * 92 + 200 * 150 * 4
    assert sum(i.solido.volume for i in diseno.instancias) == pytest.approx(esperado, rel=1e-6)


def test_numero_de_dedos_es_impar_y_al_menos_tres():
    for longitud in (9, 20, 55, 144, 194, 1000):
        for ancho in (3, 10, 15, 37, 200):
            n = numero_dedos(longitud, ancho)
            assert n >= 3 and n % 2 == 1


def test_tramos_alternos_son_complementarios():
    a = tramos_alternos(3, 197, 13, fuera_pares=True)
    b = tramos_alternos(3, 197, 13, fuera_pares=False)
    assert a[0][0] == 3 and a[-1][1] == 197
    for (a0, a1, fa), (b0, b1, fb) in zip(a, b):
        assert (a0, a1) == (b0, b1) and fa != fb
    assert a[0][2] and a[-1][2]  # los extremos son de la misma pieza


@pytest.mark.parametrize(
    "parametros, campo",
    [
        ({"largo": 5}, "largo"),
        ({"largo": 30, "espesor": 10}, "largo"),
        ({"alto": 10, "espesor": 5}, "alto"),
        ({"alto": 15, "espesor": 5, "con_tapa": True}, "alto"),
        ({"tipo_union": "soldada"}, "tipo_union"),
        ({"espesor": "grueso"}, "espesor"),
        ({"no_existe": 1}, "no_existe"),
    ],
)
def test_parametros_invalidos(parametros, campo):
    with pytest.raises(ErrorParametros) as error:
        obtener("caja").disenar(parametros)
    assert campo in [e["campo"] for e in error.value.errores]
    assert all(e["mensaje"] for e in error.value.errores)
