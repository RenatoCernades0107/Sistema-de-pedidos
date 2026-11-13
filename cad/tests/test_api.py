"""La API cumple `docs/API_cad.md`."""

from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from motor import VERSION
from motor.api import app
from motor.exportar import leer_json_glb

from conftest import leer_dxf

cliente = TestClient(app, raise_server_exceptions=False)

CAJA = {"plantilla": "caja", "parametros": {"largo": 200, "tipo_union": "encastre", "con_tapa": True}}


def test_salud(sin_clave):
    r = cliente.get("/salud")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "version": VERSION}


def test_plantillas(sin_clave):
    r = cliente.get("/plantillas")
    assert r.status_code == 200
    lista = r.json()
    caja = next(p for p in lista if p["codigo"] == "caja")
    assert set(caja) == {"codigo", "nombre", "familia", "version", "descripcion", "esquema"}
    assert caja["familia"] == "cajas" and caja["version"] == 1
    assert caja["esquema"]["type"] == "object"
    assert caja["esquema"]["properties"]["largo"]["minimum"] == 20

    r = cliente.get("/plantillas/caja")
    assert r.status_code == 200 and r.json() == caja


def test_plantilla_desconocida(sin_clave):
    r = cliente.get("/plantillas/no_existe")
    assert r.status_code == 404
    assert r.json()["detail"]["codigo"] == "plantilla_desconocida"
    for ruta in ("/generar", "/dxf", "/step"):
        r = cliente.post(ruta, json={"plantilla": "no_existe", "parametros": {}})
        assert r.status_code == 404, ruta
        assert set(r.json()["detail"]) == {"codigo", "mensaje"}


def test_generar(sin_clave):
    r = cliente.post("/generar", json=CAJA)
    assert r.status_code == 200
    d = r.json()
    assert set(d) == {
        "plantilla",
        "version_plantilla",
        "parametros",
        "dimensiones",
        "glb_base64",
        "piezas",
        "validaciones",
    }
    assert d["plantilla"] == "caja" and d["version_plantilla"] == 1
    # normalizados: los que faltaban toman su valor por defecto
    assert d["parametros"]["ancho"] == 150 and d["parametros"]["tipo_union"] == "encastre"
    assert d["dimensiones"] == {"x": 200, "y": 150, "z": 100}
    assert d["validaciones"] == []
    assert [p["id"] for p in d["piezas"]] == ["base", "frente", "lateral", "tapa"]
    for p in d["piezas"]:
        assert set(p) == {
            "id", "nombre", "cantidad", "espesor_mm", "ancho_mm", "alto_mm", "area_mm2", "perimetro_mm",
        }
    glb = base64.b64decode(d["glb_base64"])
    assert glb[:4] == b"glTF"
    assert [n["name"] for n in leer_json_glb(glb)["nodes"]] == [
        "base", "frente_1", "frente_2", "lateral_1", "lateral_2", "tapa",
    ]


def test_generar_sin_parametros_usa_los_valores_por_defecto(sin_clave):
    r = cliente.post("/generar", json={"plantilla": "caja"})
    assert r.status_code == 200
    assert r.json()["piezas"][0] == {
        "id": "base",
        "nombre": "Base",
        "cantidad": 1,
        "espesor_mm": 3,
        "ancho_mm": 200,
        "alto_mm": 150,
        "area_mm2": 30000,
        "perimetro_mm": 700,
    }


def test_generar_devuelve_avisos(sin_clave):
    r = cliente.post(
        "/generar",
        json={"plantilla": "caja", "parametros": {"tipo_union": "encastre", "espesor": 8, "ancho_dedo": 4}},
    )
    assert r.status_code == 200
    v = r.json()["validaciones"]
    assert v and all(set(x) >= {"nivel", "codigo", "mensaje"} and x["nivel"] in ("error", "aviso") for x in v)


def test_dxf(sin_clave):
    r = cliente.post("/dxf", json=CAJA)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/dxf")
    doc = leer_dxf(r.content)
    assert doc.dxfversion == "AC1009" and doc.header["$INSUNITS"] == 4
    assert {e.dxf.layer for e in doc.modelspace()} == {"CORTE"}

    con_opciones = cliente.post("/dxf", json={**CAJA, "opciones": {"kerf_mm": 0.2, "separacion_mm": 20}})
    assert con_opciones.status_code == 200
    assert con_opciones.content != r.content
    ancho = lambda d: d.header["$EXTMAX"][0] - d.header["$EXTMIN"][0]  # noqa: E731
    # 6 piezas en fila: 5 separaciones de 20 en vez de 5, y 0.2 de kerf por pieza
    assert ancho(leer_dxf(con_opciones.content)) == pytest.approx(ancho(doc) + 5 * 15 + 6 * 0.2, abs=1e-3)


def test_step(sin_clave):
    r = cliente.post("/step", json=CAJA)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/step")
    assert r.content.startswith(b"ISO-10303-21")


@pytest.mark.parametrize("ruta", ["/generar", "/dxf", "/step"])
def test_422_parametros_invalidos(sin_clave, ruta):
    r = cliente.post(ruta, json={"plantilla": "caja", "parametros": {"largo": -5, "tipo_union": "x"}})
    assert r.status_code == 422
    detalle = r.json()["detail"]
    assert set(detalle) == {"codigo", "mensaje", "errores"}
    assert detalle["codigo"] == "parametros_invalidos"
    assert isinstance(detalle["mensaje"], str) and detalle["mensaje"]
    assert {e["campo"] for e in detalle["errores"]} == {"largo", "tipo_union"}
    assert all(set(e) == {"campo", "mensaje"} and e["mensaje"] for e in detalle["errores"])


def test_422_reglas_cruzadas(sin_clave):
    r = cliente.post("/generar", json={"plantilla": "caja", "parametros": {"alto": 12, "espesor": 5}})
    assert r.status_code == 422
    assert r.json()["detail"]["errores"] == [
        {"campo": "alto", "mensaje": "Con este espesor el alto mínimo es 15 mm."}
    ]


@pytest.mark.parametrize(
    "cuerpo, campo",
    [
        ({}, "plantilla"),
        ({"plantilla": "caja", "parametros": [1, 2]}, "parametros"),
        ({"plantilla": 7}, "plantilla"),
    ],
)
def test_422_cuerpo_mal_formado(sin_clave, cuerpo, campo):
    r = cliente.post("/generar", json=cuerpo)
    assert r.status_code == 422
    detalle = r.json()["detail"]
    assert detalle["codigo"] == "parametros_invalidos"
    assert campo in [e["campo"] for e in detalle["errores"]]


def test_422_opciones_dxf_invalidas(sin_clave):
    r = cliente.post("/dxf", json={**CAJA, "opciones": {"kerf_mm": -1}})
    assert r.status_code == 422
    assert r.json()["detail"]["errores"][0]["campo"] == "opciones.kerf_mm"


def test_500_fallo_de_geometria(sin_clave, monkeypatch):
    import motor.api

    def romper(*_a, **_k):
        raise RuntimeError("se rompió")

    monkeypatch.setattr(motor.api, "exportar_glb", romper)
    r = cliente.post("/generar", json=CAJA)
    assert r.status_code == 500
    detalle = r.json()["detail"]
    assert set(detalle) == {"codigo", "mensaje"} and detalle["codigo"] == "geometria"


def test_401_con_clave_configurada(monkeypatch):
    monkeypatch.setenv("CAD_API_KEY", "secreta")
    assert cliente.get("/salud").status_code == 200  # la salud no pide clave
    peticiones = [
        ("get", "/plantillas", None),
        ("get", "/plantillas/caja", None),
        ("post", "/generar", CAJA),
        ("post", "/dxf", CAJA),
        ("post", "/step", CAJA),
    ]
    for metodo, ruta, cuerpo in peticiones:
        kwargs = {"json": cuerpo} if cuerpo else {}
        sin = getattr(cliente, metodo)(ruta, **kwargs)
        assert sin.status_code == 401, ruta
        assert sin.json()["detail"]["codigo"] == "no_autorizado"
        mala = getattr(cliente, metodo)(ruta, headers={"X-API-Key": "otra"}, **kwargs)
        assert mala.status_code == 401, ruta
        buena = getattr(cliente, metodo)(ruta, headers={"X-API-Key": "secreta"}, **kwargs)
        assert buena.status_code == 200, ruta
