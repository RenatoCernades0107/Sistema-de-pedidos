"""La API del sandbox: ejecutar, dxf, step, render y referencias."""

from __future__ import annotations

import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from sandbox.api import app

from test_sandbox_ejecutor import SOPORTE

cliente = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _sin_clave(monkeypatch):
    monkeypatch.delenv("CAD_SANDBOX_API_KEY", raising=False)


@pytest.fixture(scope="module")
def generado():
    r = cliente.post("/ejecutar", json={"codigo": SOPORTE})
    assert r.status_code == 200, r.text
    return r.json()


def test_salud():
    datos = cliente.get("/salud").json()
    assert datos["ok"] is True
    assert datos["servicio"] == "sandbox"


def test_ejecutar_misma_forma_que_generar(generado):
    assert set(generado) >= {"codigo", "glb_base64", "piezas", "dimensiones", "validaciones"}
    assert generado["codigo"] == SOPORTE


def test_error_estructurado():
    r = cliente.post("/ejecutar", json={"codigo": "import os\n"})
    assert r.status_code == 422
    detalle = r.json()["detail"]
    assert detalle["codigo"] == "codigo_invalido"
    assert detalle["error"]["tipo"] == "prohibido" and detalle["error"]["linea"] == 1


def test_clave(monkeypatch):
    monkeypatch.setenv("CAD_SANDBOX_API_KEY", "secreta")
    assert cliente.post("/ejecutar", json={"codigo": "x=1"}).status_code == 401
    assert cliente.get("/referencias", headers={"X-API-Key": "secreta"}).status_code == 200


def test_render_desde_glb(generado):
    r = cliente.post("/render", json={"glb_base64": generado["glb_base64"]})
    assert r.status_code == 200, r.text
    png = base64.b64decode(r.json()["png_base64"])
    imagen = Image.open(io.BytesIO(png))
    assert imagen.format == "PNG" and imagen.size == (960, 960)
    # Hay dibujo, no un lienzo vacío.
    colores = imagen.convert("RGB").getcolors(maxcolors=1_000_000)
    assert colores is not None and len(colores) > 10


def test_render_glb_invalido():
    r = cliente.post("/render", json={"glb_base64": base64.b64encode(b"no es glb").decode()})
    assert r.status_code == 422


def test_dxf_y_step():
    r = cliente.post("/dxf", json={"codigo": SOPORTE, "opciones": {"kerf_mm": 0.1}})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/dxf")
    r = cliente.post("/step", json={"codigo": SOPORTE})
    assert r.status_code == 200 and r.content.startswith(b"ISO-10303-21")


def test_referencias():
    lista = cliente.get("/referencias").json()
    nombres = [r["nombre"] for r in lista]
    assert "plugins/build123d/skills/build123d/SKILL.md" in nombres
    r = cliente.get("/referencias/plugins/build123d/skills/build123d/references/quick-reference.md")
    assert r.status_code == 200 and "build123d" in r.text
    assert cliente.get("/referencias/quick-reference.md").status_code == 200


@pytest.mark.parametrize(
    "nombre",
    ["../motor/api.py", "..%2F..%2Fpyproject.toml", "/etc/passwd", "plugins/../../../pyproject.toml", "LICENSE"],
)
def test_referencias_sin_salto_de_ruta(nombre):
    assert cliente.get(f"/referencias/{nombre}").status_code == 404


def _planchas_soporte(desplazar_y: float = 0.0) -> list[dict]:
    """Base (80×100) y respaldo (80×110) en una plancha de 300×300, lado a lado."""
    return [
        {
            "ancho_mm": 300,
            "alto_mm": 300,
            "piezas": [
                {"id": "base", "indice": 1, "x_mm": 10, "y_mm": 10 + desplazar_y, "rotada": False},
                {"id": "respaldo", "indice": 1, "x_mm": 120, "y_mm": 10, "rotada": False},
            ],
        }
    ]


def test_dxf_planchas():
    import ezdxf

    r = cliente.post(
        "/dxf/planchas", json={"codigo": SOPORTE, "planchas": _planchas_soporte(), "opciones": {"kerf_mm": 0.1}}
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/dxf")
    doc = ezdxf.read(io.StringIO(r.content.decode("ascii")))
    capas = {e.dxf.layer for e in doc.modelspace()}
    assert {"PLANCHA", "CORTE", "GRABADO"} <= capas
    assert len([e for e in doc.modelspace() if e.dxf.layer == "PLANCHA" and e.dxftype() == "LINE"]) == 4


def test_dxf_planchas_acomodo_invalido():
    # La base se sale de la plancha y falta el respaldo.
    planchas = _planchas_soporte(desplazar_y=250)
    planchas[0]["piezas"].pop()
    r = cliente.post("/dxf/planchas", json={"codigo": SOPORTE, "planchas": planchas})
    assert r.status_code == 422
    detalle = r.json()["detail"]
    assert detalle["codigo"] == "acomodo_invalido"
    mensajes = " ".join(e["mensaje"] for e in detalle["errores"])
    assert "se sale" in mensajes and "respaldo" in mensajes


def test_dxf_planchas_codigo_invalido_y_cuerpo():
    r = cliente.post("/dxf/planchas", json={"codigo": "import os\n", "planchas": _planchas_soporte()})
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "codigo_invalido"
    r = cliente.post("/dxf/planchas", json={"codigo": SOPORTE, "planchas": []})
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "parametros_invalidos"


# ── Contornos (logos) guardados con el diseño ───────────────────────────────

#: Un marco de 100 × 100 con un agujero de 50 × 50 y, dentro del agujero, una isla de 20 × 20.
LOGO = {
    "ancho_mm": 100,
    "alto_mm": 100,
    "trazos": [
        "M 0 0 L 100 0 L 100 100 L 0 100 Z",
        "M 25 25 L 25 75 L 75 75 L 75 25 Z",
        "M 40 40 L 60 40 L 60 60 L 40 60 Z",
    ],
}

CODIGO_LOGO = """
from diseno import pieza, caras_de_contorno, medidas_de_contorno

ancho, alto = medidas_de_contorno("logo")
caras = caras_de_contorno("logo")
piezas = [pieza(f"frente_{i}", "Frente", c, 3) for i, c in enumerate(caras, 1)]
nombre = "Logo"
print(f"{ancho}x{alto} caras={len(caras)}")
"""


def test_codigo_con_contorno():
    r = cliente.post("/ejecutar", json={"codigo": CODIGO_LOGO, "contornos": {"logo": LOGO}})
    assert r.status_code == 200, r.text
    datos = r.json()
    assert "100.0x100.0 caras=2" in datos["salida"]
    # El marco con su agujero (7500 mm²) y la isla (400 mm²), de izquierda a derecha.
    areas = sorted(round(p["area_mm2"]) for p in datos["piezas"])
    assert areas == [400, 7500]


def test_contorno_que_no_existe_explica_cuales_hay():
    r = cliente.post("/ejecutar", json={"codigo": CODIGO_LOGO, "contornos": {"otro": LOGO}})
    assert r.status_code == 422
    assert "otro" in r.text and "logo" in r.text


def test_contornos_invalidos_se_rechazan():
    # Sin trazos, ancho 0 y demasiados contornos.
    for contornos in (
        {"logo": {**LOGO, "trazos": []}},
        {"logo": {**LOGO, "ancho_mm": 0}},
        {f"c{i}": LOGO for i in range(21)},
    ):
        r = cliente.post("/ejecutar", json={"codigo": CODIGO_LOGO, "contornos": contornos})
        assert r.status_code == 422, contornos


def test_dxf_con_contorno_trae_las_curvas():
    arco = {"ancho_mm": 100, "alto_mm": 50, "trazos": ["M 0 0 C 0 66.6667 100 66.6667 100 0 Z"]}
    codigo = (
        "from diseno import pieza, caras_de_contorno\n"
        "piezas = [pieza('arco', 'Arco', caras_de_contorno('arco')[0], 3)]\n"
        "nombre = 'Arco'\n"
    )
    r = cliente.post("/dxf", json={"codigo": codigo, "contornos": {"arco": arco}})
    assert r.status_code == 200, r.text
    # Una curva real en el DXF (spline o arcos), no solo rectas.
    texto = r.content.decode("latin-1", errors="replace")
    assert "SPLINE" in texto or "ARC" in texto
