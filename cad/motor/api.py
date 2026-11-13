"""
API del motor CAD. El contrato está en `docs/API_cad.md`.

Sin estado: recibe una plantilla y sus parámetros y devuelve geometría. Solo la
llama el servidor de Next.js, nunca el navegador (por eso no hay CORS).

Variables de entorno:
  CAD_API_KEY          si está definida, se exige en la cabecera `X-API-Key`.
  CAD_PLANCHA_MAX_MM   plancha más grande, p. ej. "2440x1220" (por defecto).
"""

from __future__ import annotations

import base64
import hmac
import os
from typing import Any

import structlog
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from . import VERSION, bitacora
from .exportar import (
    SEPARACION_MM,
    ErrorAcomodo,
    PiezaEnPlancha,
    PlanchaAcomodada,
    exportar_dxf,
    exportar_dxf_planchas,
    exportar_glb,
    exportar_step,
    validar_planchas,
)
from .plantillas import describir, listar, obtener
from .plantillas.base import Diseno, ErrorParametros
from .validacion import validar

bitacora.configurar("motor")
registro = structlog.get_logger("motor.api")

app = FastAPI(title="Motor CAD Plexiacril", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)
bitacora.instalar(app)


# --------------------------------------------------------------------------
# Entradas
# --------------------------------------------------------------------------


class Solicitud(BaseModel):
    model_config = ConfigDict(extra="ignore")

    plantilla: str
    parametros: dict[str, Any] = Field(default_factory=dict)


class OpcionesDxf(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kerf_mm: float = Field(0, ge=0, le=5)
    separacion_mm: float = Field(SEPARACION_MM, ge=0, le=500)


class SolicitudDxf(Solicitud):
    opciones: OpcionesDxf = Field(default_factory=OpcionesDxf)


class EntradaPiezaPlancha(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    indice: int = Field(ge=1)
    x_mm: float
    y_mm: float
    rotada: bool = False


class EntradaPlancha(BaseModel):
    model_config = ConfigDict(extra="ignore")

    ancho_mm: float = Field(gt=0, le=10000)
    alto_mm: float = Field(gt=0, le=10000)
    piezas: list[EntradaPiezaPlancha] = Field(default_factory=list)


class OpcionesDxfPlanchas(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kerf_mm: float = Field(0, ge=0, le=5)


class SolicitudDxfPlanchas(Solicitud):
    opciones: OpcionesDxfPlanchas = Field(default_factory=OpcionesDxfPlanchas)
    planchas: list[EntradaPlancha] = Field(min_length=1, max_length=200)


# --------------------------------------------------------------------------
# Errores con la forma del contrato
# --------------------------------------------------------------------------


def _error(estado: int, codigo: str, mensaje: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=estado, detail={"codigo": codigo, "mensaje": mensaje, **extra})


@app.exception_handler(RequestValidationError)
async def _cuerpo_invalido(request: Request, error: RequestValidationError) -> JSONResponse:
    """El cuerpo de la petición no tiene la forma esperada → 422 del contrato."""
    errores = []
    for e in error.errors():
        partes = [str(p) for p in e.get("loc", ()) if p != "body"]
        errores.append({"campo": ".".join(partes), "mensaje": _mensaje_cuerpo(e)})
    bitacora.anotar_error(
        request,
        codigo="parametros_invalidos",
        errores=[{**err, "tipo": e.get("type")} for err, e in zip(errores, error.errors())],
    )
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "codigo": "parametros_invalidos",
                "mensaje": "La petición no tiene la forma esperada.",
                "errores": errores,
            }
        },
    )


def _mensaje_cuerpo(e: dict[str, Any]) -> str:
    tipo = e.get("type", "")
    ctx = e.get("ctx") or {}
    if tipo == "missing":
        return "Falta este campo."
    if tipo == "json_invalid":
        return "El cuerpo no es JSON válido."
    if tipo == "greater_than_equal":
        return f"Debe ser mayor o igual que {ctx.get('ge')}."
    if tipo == "less_than_equal":
        return f"Debe ser menor o igual que {ctx.get('le')}."
    if tipo.startswith(("float", "int")):
        return "Debe ser un número."
    if tipo.startswith("string"):
        return "Debe ser un texto."
    if tipo == "too_short":
        return "No puede estar vacío."
    if tipo == "greater_than":
        return f"Debe ser mayor que {ctx.get('gt')}."
    if tipo.startswith(("dict", "model")):
        return "Debe ser un objeto."
    return "Valor no válido."


@app.exception_handler(Exception)
async def _fallo(request: Request, error: Exception) -> JSONResponse:
    registro.exception("fallo_no_previsto", metodo=request.method, ruta=request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": {"codigo": "geometria", "mensaje": f"Fallo al generar la geometría: {error}"}},
    )


# --------------------------------------------------------------------------
# Autenticación
# --------------------------------------------------------------------------


def exigir_clave(x_api_key: str | None = Header(default=None)) -> None:
    esperada = os.environ.get("CAD_API_KEY", "")
    if not esperada:
        return  # sin clave configurada (solo local) no se exige cabecera
    if not x_api_key or not hmac.compare_digest(x_api_key.encode(), esperada.encode()):
        raise _error(401, "no_autorizado", "Falta la cabecera X-API-Key o no es válida.")


protegido = [Depends(exigir_clave)]


# --------------------------------------------------------------------------
# Ayudas
# --------------------------------------------------------------------------


def _plantilla(codigo: str):
    plantilla = obtener(codigo)
    if plantilla is None:
        raise _error(404, "plantilla_desconocida", f"No existe la plantilla «{codigo}».")
    return plantilla


def _disenar(solicitud: Solicitud) -> Diseno:
    plantilla = _plantilla(solicitud.plantilla)
    try:
        return plantilla.disenar(solicitud.parametros)
    except ErrorParametros as e:
        raise _error(422, "parametros_invalidos", e.mensaje, errores=e.errores) from e
    except Exception as e:
        registro.exception("fallo_geometria", plantilla=solicitud.plantilla, parametros=solicitud.parametros)
        raise _error(500, "geometria", f"No se pudo construir la geometría: {e}") from e


def _geometria(funcion, *args: Any, **kwargs: Any):
    try:
        return funcion(*args, **kwargs)
    except Exception as e:
        registro.exception("fallo_geometria", funcion=getattr(funcion, "__name__", repr(funcion)))
        raise _error(500, "geometria", f"Fallo al generar la geometría: {e}") from e


# --------------------------------------------------------------------------
# Rutas
# --------------------------------------------------------------------------


@app.get("/salud")
def salud() -> dict[str, Any]:
    return {"ok": True, "version": VERSION}


@app.get("/plantillas", dependencies=protegido)
def plantillas() -> list[dict[str, Any]]:
    return [describir(p) for p in listar()]


@app.get("/plantillas/{codigo}", dependencies=protegido)
def plantilla(codigo: str) -> dict[str, Any]:
    return describir(_plantilla(codigo))


@app.post("/generar", dependencies=protegido)
def generar(solicitud: Solicitud) -> dict[str, Any]:
    diseno = _disenar(solicitud)
    glb = _geometria(exportar_glb, diseno)
    return {
        "plantilla": diseno.plantilla.codigo,
        "version_plantilla": diseno.plantilla.version,
        "parametros": diseno.parametros_normalizados(),
        "dimensiones": _geometria(diseno.dimensiones),
        "glb_base64": base64.b64encode(glb).decode("ascii"),
        "piezas": _geometria(diseno.despiece),
        "validaciones": _geometria(validar, diseno),
    }


@app.post("/dxf", dependencies=protegido)
def dxf(solicitud: SolicitudDxf) -> Response:
    diseno = _disenar(solicitud)
    contenido = _geometria(
        exportar_dxf,
        diseno,
        kerf_mm=solicitud.opciones.kerf_mm,
        separacion_mm=solicitud.opciones.separacion_mm,
    )
    return Response(
        content=contenido,
        media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{diseno.plantilla.codigo}.dxf"'},
    )


@app.post("/step", dependencies=protegido)
def step(solicitud: Solicitud) -> Response:
    diseno = _disenar(solicitud)
    contenido = _geometria(exportar_step, diseno)
    return Response(
        content=contenido,
        media_type="application/step",
        headers={"Content-Disposition": f'attachment; filename="{diseno.plantilla.codigo}.step"'},
    )


@app.post("/dxf/planchas", dependencies=protegido)
def dxf_planchas(solicitud: SolicitudDxfPlanchas) -> Response:
    diseno = _disenar(solicitud)
    planchas = [
        PlanchaAcomodada(
            ancho_mm=p.ancho_mm,
            alto_mm=p.alto_mm,
            piezas=[PiezaEnPlancha(pp.id, pp.indice, pp.x_mm, pp.y_mm, pp.rotada) for pp in p.piezas],
        )
        for p in solicitud.planchas
    ]
    try:
        validar_planchas(diseno, planchas)
    except ErrorAcomodo as e:
        raise _error(422, "acomodo_invalido", e.mensaje, errores=e.errores) from e
    contenido = _geometria(exportar_dxf_planchas, diseno, planchas, kerf_mm=solicitud.opciones.kerf_mm)
    return Response(
        content=contenido,
        media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{diseno.plantilla.codigo}-planchas.dxf"'},
    )
