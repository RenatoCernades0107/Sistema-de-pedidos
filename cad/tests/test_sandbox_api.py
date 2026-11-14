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
    assert cliente.get("/salud").json()["ok"] is True


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
