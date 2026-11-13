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
