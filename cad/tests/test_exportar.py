"""DXF, GLB y STEP salen de las mismas piezas y con el formato acordado."""

from __future__ import annotations

import base64
import math

import pytest
from build123d import Edge, Location, Vector, Wire
from pydantic import Field

from motor.exportar import acomodar, exportar_dxf, exportar_glb, exportar_step, leer_json_glb
from motor.plantillas.base import Parametros, Pieza, Plantilla, cara_poligono, cara_rectangulo, con_agujeros

from conftest import caja_de, caja_entidad, disenar_caja, entidades_en, leer_dxf


# ---------------------------------------------------------------- DXF: caja


def test_dxf_formato(caso):
    _, diseno = caso
    doc = leer_dxf(exportar_dxf(diseno))
    assert doc.dxfversion == "AC1009"  # R12
    assert doc.header["$INSUNITS"] == 4  # milímetros
    capas = {capa.dxf.name: capa.dxf.color for capa in doc.layers}
    assert set(capas) <= {"0", "Defpoints", "CORTE", "GRABADO"}
    assert capas["CORTE"] == 1 and capas["GRABADO"] == 3
    entidades = list(doc.modelspace())
    assert entidades
    assert {e.dxf.layer for e in entidades} == {"CORTE"}  # la caja no lleva grabado
    assert {e.dxf.color for e in entidades} == {1}
    assert {e.dxftype() for e in entidades} <= {"LINE", "ARC", "CIRCLE"}


def test_dxf_cada_pieza_mide_lo_del_despiece(caso):
    _, diseno = caso
    separacion = 7.0
    doc = leer_dxf(exportar_dxf(diseno, separacion_mm=separacion))
    colocadas = acomodar(diseno, separacion_mm=separacion)
    despiece = {pz["id"]: pz for pz in diseno.despiece()}
    assert len(colocadas) == sum(pz["cantidad"] for pz in despiece.values())

    usadas = 0
    for c in colocadas:
        entidades = entidades_en(doc, c.rect)
        assert entidades, c.pieza.id
        usadas += len(entidades)
        x0, y0, x1, y1 = caja_de(entidades)
        assert x1 - x0 == pytest.approx(despiece[c.pieza.id]["ancho_mm"], abs=0.001)
        assert y1 - y0 == pytest.approx(despiece[c.pieza.id]["alto_mm"], abs=0.001)
        # el largo dibujado es el perímetro de corte
        largo = sum(e.dxf.start.distance(e.dxf.end) for e in entidades)
        assert largo == pytest.approx(despiece[c.pieza.id]["perimetro_mm"], abs=0.01)
    assert usadas == len(doc.modelspace())  # cada entidad pertenece a una sola pieza

    # sin solaparse y con la separación pedida
    for i, a in enumerate(colocadas):
        for b in colocadas[i + 1 :]:
            ax0, ay0, ax1, ay1 = a.rect
            bx0, by0, bx1, by1 = b.rect
            hueco_x = max(bx0 - ax1, ax0 - bx1)
            hueco_y = max(by0 - ay1, ay0 - by1)
            assert max(hueco_x, hueco_y) >= separacion - 1e-6


def test_dxf_contornos_cerrados():
    """Cada vértice del dibujo es extremo de exactamente dos líneas."""
    diseno = disenar_caja({"tipo_union": "encastre", "con_tapa": True})
    doc = leer_dxf(exportar_dxf(diseno))
    veces: dict[tuple[float, float], int] = {}
    for e in doc.modelspace():
        for p in (e.dxf.start, e.dxf.end):
            clave = (round(p[0], 4), round(p[1], 4))
            veces[clave] = veces.get(clave, 0) + 1
    assert set(veces.values()) == {2}


def test_dxf_salta_de_fila_al_llegar_al_ancho_de_la_plancha():
    diseno = disenar_caja({"tipo_union": "a_tope"})
    colocadas = acomodar(diseno, separacion_mm=5, ancho_max_mm=450)
    assert max(c.rect[2] for c in colocadas) <= 450
    assert len({round(c.rect[1], 3) for c in colocadas}) > 1


@pytest.mark.parametrize("union", ["a_tope", "encastre"])
def test_dxf_kerf_agranda_el_contorno_exterior(union):
    diseno = disenar_caja({"tipo_union": union, "espesor": 3})
    kerf = 0.2
    doc = leer_dxf(exportar_dxf(diseno, kerf_mm=kerf))
    despiece = {pz["id"]: pz for pz in diseno.despiece()}
    for c in acomodar(diseno, kerf_mm=kerf):
        x0, y0, x1, y1 = caja_de(entidades_en(doc, c.rect))
        assert x1 - x0 == pytest.approx(despiece[c.pieza.id]["ancho_mm"] + kerf, abs=0.001)
        assert y1 - y0 == pytest.approx(despiece[c.pieza.id]["alto_mm"] + kerf, abs=0.001)


# ------------------------------------------- DXF: curvas, agujeros y grabado


class _P(Parametros):
    lado: float = Field(100, title="Lado", description="Lado en mm.", ge=1, le=5000)


def _placa(p):
    """Placa con una esquina redondeada, un agujero redondo, una ranura y un círculo grabado."""
    r = 10
    puntos = [(0, 0), (p.lado, 0), (p.lado, 60 - r)]
    exterior = Wire(
        [
            Edge.make_line(Vector(0, 0), Vector(p.lado, 0)),
            Edge.make_line(Vector(p.lado, 0), Vector(p.lado, 60 - r)),
            Edge.make_three_point_arc(
                Vector(p.lado, 60 - r),
                Vector(p.lado - r + r * math.cos(math.pi / 4), 60 - r + r * math.sin(math.pi / 4)),
                Vector(p.lado - r, 60),
            ),
            Edge.make_line(Vector(p.lado - r, 60), Vector(0, 60)),
            Edge.make_line(Vector(0, 60), Vector(0, 0)),
        ]
    )
    del puntos
    from build123d import Face

    cara = con_agujeros(
        Face(exterior),
        [
            Wire([Edge.make_circle(8).moved(Location((30, 30, 0)))]),
            cara_poligono([(55, 20), (75, 20), (75, 26), (55, 26)]).outer_wire(),
        ],
    )
    grabado = [Edge.make_circle(4).moved(Location((30, 30, 0))), Edge.make_line(Vector(50, 45), Vector(80, 45))]
    return [Pieza("placa", "Placa", cara, 3, grabado=grabado)]


PLACA = Plantilla("placa", "Placa", "letreros", 1, "De prueba.", _P, _placa)


def test_dxf_curvas_reales_y_capas():
    diseno = PLACA.disenar({})
    doc = leer_dxf(exportar_dxf(diseno))
    por_capa: dict[str, list] = {"CORTE": [], "GRABADO": []}
    for e in doc.modelspace():
        por_capa[e.dxf.layer].append(e)
        assert e.dxf.color == {"CORTE": 1, "GRABADO": 3}[e.dxf.layer]

    tipos_corte = sorted(e.dxftype() for e in por_capa["CORTE"])
    assert tipos_corte == ["ARC", "CIRCLE"] + ["LINE"] * 8  # 4 del exterior + 4 de la ranura
    arco = next(e for e in por_capa["CORTE"] if e.dxftype() == "ARC")
    assert arco.dxf.radius == pytest.approx(10)
    assert (arco.dxf.center.x, arco.dxf.center.y) == pytest.approx((90, 50))
    assert (arco.dxf.start_angle % 360, arco.dxf.end_angle % 360) == pytest.approx((0, 90))
    circulo = next(e for e in por_capa["CORTE"] if e.dxftype() == "CIRCLE")
    assert circulo.dxf.radius == pytest.approx(8)

    assert sorted(e.dxftype() for e in por_capa["GRABADO"]) == ["CIRCLE", "LINE"]
    x0, y0, x1, y1 = caja_de(por_capa["CORTE"])
    assert (x1 - x0, y1 - y0) == pytest.approx((100, 60))


def test_dxf_kerf_afuera_en_el_exterior_y_adentro_en_los_agujeros():
    diseno = PLACA.disenar({})
    kerf = 0.3
    doc = leer_dxf(exportar_dxf(diseno, kerf_mm=kerf))
    corte = [e for e in doc.modelspace() if e.dxf.layer == "CORTE"]
    x0, y0, x1, y1 = caja_de(corte)
    assert (x1 - x0, y1 - y0) == pytest.approx((100 + kerf, 60 + kerf), abs=1e-4)
    # el agujero redondo se achica medio kerf de radio
    redondos = [e for e in corte if e.dxftype() in ("CIRCLE", "ARC") and e.dxf.radius < 9]
    assert redondos and all(e.dxf.radius == pytest.approx(8 - kerf / 2, abs=1e-4) for e in redondos)
    # la ranura de 20 × 6 queda de 19.7 × 5.7
    ranura = [e for e in corte if e.dxftype() == "LINE" and 20 < (caja_entidad(e)[1] - y0) < 27]
    rx0, ry0, rx1, ry1 = caja_de(ranura)
    assert (rx1 - rx0, ry1 - ry0) == pytest.approx((20 - kerf, 6 - kerf), abs=1e-4)
    # el grabado no se compensa
    grabado = [e for e in doc.modelspace() if e.dxf.layer == "GRABADO" and e.dxftype() == "CIRCLE"]
    assert grabado[0].dxf.radius == pytest.approx(4)


def test_despiece_con_agujeros_cuenta_el_corte_interior():
    pieza = PLACA.disenar({}).despiece()[0]
    recto = 100 + 50 + 90 + 60
    assert pieza["perimetro_mm"] == pytest.approx(recto + math.pi * 10 / 2 + 2 * math.pi * 8 + 52, abs=0.01)
    area = 100 * 60 - (100 - math.pi * 100 / 4) - math.pi * 64 - 120
    assert pieza["area_mm2"] == pytest.approx(area, abs=0.01)


# ------------------------------------------------------------- GLB y STEP


def test_glb(caso):
    p, diseno = caso
    glb = exportar_glb(diseno)
    assert glb[:4] == b"glTF"
    assert int.from_bytes(glb[8:12], "little") == len(glb)
    assert base64.b64decode(base64.b64encode(glb)) == glb
    gltf = leer_json_glb(glb)
    nombres = [n["name"] for n in gltf["nodes"]]
    assert nombres == [i.nombre for i in diseno.instancias]
    esperados = {"base", "frente_1", "frente_2", "lateral_1", "lateral_2"}
    if p["con_tapa"]:
        esperados.add("tapa")
        if p["tipo_tapa"] == "con_pestana":
            esperados.add("pestana_tapa")
    assert set(nombres) == esperados
    assert gltf["scenes"][0]["nodes"] == list(range(len(nombres)))

    # metros y Y arriba: la caja del GLB es la de la caja pedida
    posiciones = [gltf["accessors"][m["primitives"][0]["attributes"]["POSITION"]] for m in gltf["meshes"]]
    mn = [min(a["min"][i] for a in posiciones) for i in range(3)]
    mx = [max(a["max"][i] for a in posiciones) for i in range(3)]
    medidas = [(mx[i] - mn[i]) * 1000 for i in range(3)]
    assert medidas == pytest.approx([p["largo"], p["alto"], p["ancho"]], abs=0.01)
    assert mn[1] == pytest.approx(0, abs=1e-5)  # apoyada en el suelo


def test_glb_volumen_y_normales_hacia_afuera():
    import numpy as np

    from motor.exportar import _triangulos

    diseno = disenar_caja({"tipo_union": "encastre"})
    for inst in diseno.instancias:
        posiciones, normales = _triangulos(inst.solido, 0.05, 0.3)
        tri = posiciones.reshape(-1, 3, 3).astype(float) * 1000
        volumen = np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6
        assert volumen == pytest.approx(inst.solido.volume, rel=1e-3)
        assert np.allclose(np.linalg.norm(normales, axis=1), 1, atol=1e-4)


def test_step():
    diseno = disenar_caja({"tipo_union": "encastre", "con_tapa": True})
    step = exportar_step(diseno)
    assert step.startswith(b"ISO-10303-21")
    assert step.rstrip().endswith(b"END-ISO-10303-21;")
    for inst in diseno.instancias:
        assert inst.nombre.encode() in step
