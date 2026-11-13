"""Logs estructurados: una línea «peticion» por petición con el porqué del error."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

import motor.api
from motor.api import app as app_motor
from sandbox.api import app as app_sandbox

motor_cli = TestClient(app_motor, raise_server_exceptions=False)
sandbox_cli = TestClient(app_sandbox, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _sin_claves(monkeypatch):
    monkeypatch.delenv("CAD_API_KEY", raising=False)
    monkeypatch.delenv("CAD_SANDBOX_API_KEY", raising=False)


def _peticiones(logs):
    return [e for e in logs if e["event"] == "peticion"]


def test_cuerpo_invalido_dice_que_campo():
    with capture_logs() as logs:
        r = sandbox_cli.post("/ejecutar", json={})
    assert r.status_code == 422
    (linea,) = _peticiones(logs)
    assert linea["log_level"] == "warning"
    assert linea["ruta"] == "/ejecutar" and linea["estado"] == 422
    assert linea["codigo"] == "parametros_invalidos"
    assert linea["errores"][0]["campo"] == "codigo" and linea["errores"][0]["tipo"] == "missing"
    assert linea["duracion_ms"] >= 0 and linea["id_peticion"]


def test_codigo_invalido_trae_error_y_no_el_codigo():
    codigo = "from build123d import *\n\nx = 1\nresultado = no_existe(3)\n"
    with capture_logs() as logs:
        r = sandbox_cli.post("/ejecutar", json={"codigo": codigo})
    assert r.status_code == 422
    (linea,) = _peticiones(logs)
    assert linea["codigo"] == "codigo_invalido"
    assert "no_existe" in linea["mensaje"]
    assert linea["error"]["linea"] == 4
    assert "codigo_fuente" not in linea
    assert linea["codigo_lineas"] == 5 and len(linea["codigo_sha"]) == 12
    # El código completo solo va en un evento de nivel debug.
    (fuente,) = [e for e in logs if e["event"] == "codigo_fuente"]
    assert fuente["log_level"] == "debug" and fuente["codigo"] == codigo


def test_404_motor():
    with capture_logs() as logs:
        r = motor_cli.get("/plantillas/no-existe")
    assert r.status_code == 404
    (linea,) = _peticiones(logs)
    assert linea["codigo"] == "plantilla_desconocida" and linea["estado"] == 404


def test_500_registra_traza(monkeypatch):
    def romper():
        raise RuntimeError("se rompió")

    monkeypatch.setattr(motor.api, "listar", romper)
    with capture_logs() as logs:
        r = motor_cli.get("/plantillas", headers={"X-Request-ID": "abc123"})
    assert r.status_code == 500
    (linea,) = _peticiones(logs)
    assert linea["log_level"] == "error" and linea["excepcion"] == "RuntimeError"
    (fallo,) = [e for e in logs if e["event"] == "fallo_no_previsto"]
    assert fallo["exc_info"] is True and fallo["ruta"] == "/plantillas"


def test_id_de_peticion():
    r = motor_cli.get("/salud", headers={"X-Request-ID": "desde-next"})
    assert r.headers["X-Request-ID"] == "desde-next"
    assert len(motor_cli.get("/salud").headers["X-Request-ID"]) == 12


def test_salud_en_debug():
    with capture_logs() as logs:
        sandbox_cli.get("/salud")
    (linea,) = _peticiones(logs)
    assert linea["log_level"] == "debug"
