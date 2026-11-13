"""
Logs estructurados (structlog) del motor CAD y del sandbox.

Una línea por petición con método, ruta, estado, duración e id de petición y,
si hubo error, su código y detalle (lo que se devolvió al cliente). Sustituye
al access log de uvicorn, que solo decía «POST /ejecutar 422».

Variables de entorno:
  CAD_LOG_NIVEL     DEBUG, INFO (por defecto), WARNING, ERROR.
  CAD_LOG_FORMATO   «json» o «consola». Por defecto, consola si la salida es una
                    terminal y JSON si no (Docker, Lambda → CloudWatch).

Con CAD_LOG_NIVEL=DEBUG el sandbox registra además el código completo que falló.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sys
import time
import uuid
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response

CABECERA_ID = "X-Request-ID"
RUTAS_SILENCIOSAS = {"/salud"}  # el readiness check del Lambda Web Adapter la llama sin parar

_servicio = "cad"
_registro = structlog.get_logger("cad.peticiones")


def _con_servicio(_: Any, __: str, evento: dict[str, Any]) -> dict[str, Any]:
    evento.setdefault("servicio", _servicio)
    return evento


def _formato() -> str:
    formato = os.environ.get("CAD_LOG_FORMATO", "").strip().lower()
    if formato in ("json", "consola"):
        return formato
    return "consola" if sys.stderr.isatty() else "json"


def configurar(servicio: str) -> None:
    """Configura structlog y redirige a él el logging de stdlib (uvicorn, ezdxf...)."""
    global _servicio
    _servicio = servicio
    nivel = logging.getLevelName(os.environ.get("CAD_LOG_NIVEL", "INFO").strip().upper())
    if not isinstance(nivel, int):
        nivel = logging.INFO
    json = _formato() == "json"

    comunes: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        _con_servicio,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]
    structlog.configure(
        processors=[structlog.stdlib.filter_by_level, *comunes, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=False,  # permite structlog.testing.capture_logs en las pruebas
    )
    final: list[Any] = (
        [structlog.processors.dict_tracebacks, structlog.processors.JSONRenderer(ensure_ascii=False)]
        if json
        else [structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())]
    )
    formateador = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=comunes,
        processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta, *final],
    )
    manejador = logging.StreamHandler(sys.stderr)
    manejador.setFormatter(formateador)
    manejador._cad_bitacora = True  # type: ignore[attr-defined]

    raiz = logging.getLogger()
    raiz.handlers = [h for h in raiz.handlers if not getattr(h, "_cad_bitacora", False)]
    raiz.addHandler(manejador)
    raiz.setLevel(nivel)

    # uvicorn configura sus loggers antes de importar la app; aquí se les quitan
    # sus manejadores para que pasen por el nuestro. El access log se apaga: lo
    # sustituye la línea «peticion» del middleware, que sí dice por qué falló.
    for nombre in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(nombre)
        logger.handlers = []
        logger.propagate = True
    acceso = logging.getLogger("uvicorn.access")
    acceso.handlers = []
    acceso.propagate = False
    acceso.disabled = True


def anotar_error(request: Request, **campos: Any) -> None:
    """Guarda el detalle de un error para la línea «peticion» de esta petición."""
    previo = getattr(request.state, "error_log", None) or {}
    request.state.error_log = {**previo, **campos}


def resumir_codigo(codigo: str) -> dict[str, Any]:
    """Huella del código del usuario en vez del código entero (puede tener 100 000 caracteres)."""
    return {
        "codigo_lineas": codigo.count("\n") + 1,
        "codigo_sha": hashlib.sha256(codigo.encode("utf-8", errors="replace")).hexdigest()[:12],
    }


def _detalle_para_log(detalle: Any) -> dict[str, Any]:
    if not isinstance(detalle, dict):
        return {"mensaje": str(detalle)}
    salida = dict(detalle)
    codigo = salida.pop("codigo_fuente", None)
    if isinstance(codigo, str):
        salida |= resumir_codigo(codigo)
        _registro.debug("codigo_fuente", codigo_sha=salida["codigo_sha"], codigo=codigo)
    return salida


def instalar(app: FastAPI) -> None:
    """Middleware de la línea por petición y registro de los HTTPException."""

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, error: StarletteHTTPException) -> Response:
        anotar_error(request, **_detalle_para_log(error.detail))
        return await http_exception_handler(request, error)

    @app.middleware("http")
    async def _registrar_peticion(request: Request, call_next) -> Response:
        id_peticion = (request.headers.get(CABECERA_ID) or "")[:64] or uuid.uuid4().hex[:12]
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(id_peticion=id_peticion, servicio=_servicio)
        inicio = time.perf_counter()
        campos: dict[str, Any] = {
            "id_peticion": id_peticion,
            "metodo": request.method,
            "ruta": request.url.path,
            "cliente": request.client.host if request.client else None,
        }
        try:
            respuesta = await call_next(request)
        except Exception as e:
            # El handler de Exception de la app registra la traza; aquí solo la línea de la petición.
            _registro.error(
                "peticion",
                **campos,
                estado=500,
                duracion_ms=round((time.perf_counter() - inicio) * 1000, 1),
                excepcion=type(e).__name__,
            )
            raise
        estado = respuesta.status_code
        campos |= {"estado": estado, "duracion_ms": round((time.perf_counter() - inicio) * 1000, 1)}
        campos |= getattr(request.state, "error_log", None) or {}
        if estado >= 500:
            _registro.error("peticion", **campos)
        elif estado >= 400:
            _registro.warning("peticion", **campos)
        elif request.url.path in RUTAS_SILENCIOSAS:
            _registro.debug("peticion", **campos)
        else:
            _registro.info("peticion", **campos)
        respuesta.headers[CABECERA_ID] = id_peticion
        return respuesta
