"""Varios diseños como uno solo, para cortarlos juntos (`motor/proyecto.py`)."""

from __future__ import annotations

import pytest

from motor.exportar import (
    ErrorAcomodo,
    PiezaEnPlancha,
    PlanchaAcomodada,
    exportar_dxf,
    exportar_dxf_planchas,
    validar_planchas,
)
from motor.proyecto import (
    SEPARADOR_REF,
    disenar_plantilla,
    id_de_proyecto,
    seleccionar_copias,
    unir_disenos,
)

from conftest import leer_dxf


def _caja(largo: float = 100):
    return disenar_plantilla("caja", {"largo": largo})


def test_el_id_lleva_el_prefijo_del_diseno():
    assert id_de_proyecto("d2", "lateral") == f"d2{SEPARADOR_REF}lateral"
    with pytest.raises(ValueError, match="demasiado largo"):
        id_de_proyecto("d1", "x" * 70)


def test_unir_no_mezcla_piezas_que_se_llaman_igual():
    unido = unir_disenos([("d1", _caja(100)), ("d2", _caja(150))])
    ids = [p.id for p in unido.piezas]
    assert len(ids) == len(set(ids)) == 2 * len(_caja().piezas)
    assert {"d1__base", "d2__base", "d1__lateral", "d2__lateral"} <= set(ids)
    # Los nodos (nombres de cada copia) también quedan prefijados.
    lateral = next(p for p in unido.piezas if p.id == "d2__lateral")
    assert all(n.startswith("d2__") for n in lateral.nombres_nodo())
    # Y la geometría de cada una es la de su diseño, no la del otro.
    base1 = next(p for p in unido.piezas if p.id == "d1__base")
    base2 = next(p for p in unido.piezas if p.id == "d2__base")
    assert base1.ancho_mm != base2.ancho_mm


def test_unir_rechaza_referencias_repetidas_y_listas_vacias():
    with pytest.raises(ValueError, match="misma referencia"):
        unir_disenos([("d1", _caja()), ("d1", _caja())])
    with pytest.raises(ValueError, match="No hay diseños"):
        unir_disenos([])


def test_seleccionar_copias_deja_solo_las_pedidas_y_conserva_sus_nodos():
    caja = _caja()
    lateral = next(p for p in caja.piezas if p.id == "lateral")
    assert lateral.cantidad >= 2
    nodos = lateral.nombres_nodo()
    solo = seleccionar_copias(caja, {"lateral": [2]})
    assert [p.id for p in solo.piezas] == ["lateral"]
    assert solo.piezas[0].cantidad == 1
    assert solo.piezas[0].nombres_nodo() == [nodos[1]]


def test_seleccionar_copias_valida_lo_que_pide():
    caja = _caja()
    with pytest.raises(ValueError, match="No hay piezas"):
        seleccionar_copias(caja, {"fantasma": [1]})
    with pytest.raises(ValueError, match="no existe la 99"):
        seleccionar_copias(caja, {"lateral": [99]})
    with pytest.raises(ValueError, match="Ninguna copia|No quedó"):
        seleccionar_copias(caja, {"lateral": []})


def test_el_dxf_suelto_de_una_copia_trae_solo_esa(tmp_path):
    caja = _caja()
    completo = leer_dxf(exportar_dxf(caja))
    una = leer_dxf(exportar_dxf(seleccionar_copias(caja, {"base": [1]})))
    assert len(list(una.modelspace())) < len(list(completo.modelspace()))
    assert len(list(una.modelspace())) > 0


def _plancha_con(unido, ids_y_x):
    """Una plancha grande con una copia de cada pieza pedida, una al lado de la otra."""
    piezas = []
    x = 10.0
    for id_pieza, indice in ids_y_x:
        p = next(p for p in unido.piezas if p.id == id_pieza)
        piezas.append(PiezaEnPlancha(id_pieza, indice, x, 10.0))
        x += p.ancho_mm + 20
    return PlanchaAcomodada(ancho_mm=5000, alto_mm=1000, piezas=piezas, etiqueta="Prueba 3 mm")


def test_las_planchas_de_un_proyecto_validan_y_se_dibujan_con_piezas_de_los_dos():
    unido = unir_disenos([("d1", _caja(100)), ("d2", _caja(150))])
    plancha = _plancha_con(unido, [("d1__base", 1), ("d2__base", 1)])
    # Faltan las demás copias (van en otra plancha o se cortan aparte): solo vale `parcial`.
    with pytest.raises(ErrorAcomodo):
        validar_planchas(unido, [plancha], parcial=False)
    validar_planchas(unido, [plancha], parcial=True)
    dxf = leer_dxf(exportar_dxf_planchas(unido, [plancha], parcial=True))
    assert len(list(dxf.modelspace())) > 0
    assert "PLANCHA" in {e.dxf.layer for e in dxf.modelspace()}


def test_una_copia_repetida_o_de_un_diseno_que_no_existe_no_pasa():
    unido = unir_disenos([("d1", _caja(100)), ("d2", _caja(100))])
    repetida = PlanchaAcomodada(
        ancho_mm=5000,
        alto_mm=1000,
        piezas=[PiezaEnPlancha("d1__base", 1, 10, 10), PiezaEnPlancha("d1__base", 1, 300, 10)],
    )
    with pytest.raises(ErrorAcomodo) as e:
        validar_planchas(unido, [repetida], parcial=True)
    assert any("está repetida" in x["mensaje"] for x in e.value.errores)

    # `base` sin prefijo ya no existe: la pieza es de un diseño.
    sin_prefijo = PlanchaAcomodada(ancho_mm=5000, alto_mm=1000, piezas=[PiezaEnPlancha("base", 1, 10, 10)])
    with pytest.raises(ErrorAcomodo) as e:
        validar_planchas(unido, [sin_prefijo], parcial=True)
    assert any("no tiene la pieza" in x["mensaje"] for x in e.value.errores)


def test_disenar_plantilla_explica_la_que_no_existe():
    with pytest.raises(ValueError, match="No existe la plantilla"):
        disenar_plantilla("no_existe", {})
