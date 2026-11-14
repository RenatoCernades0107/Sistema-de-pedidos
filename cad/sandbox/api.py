"""
API del sandbox de diseño libre. Contrato en `docs/API_cad.md` («Diseño libre»).

Servicio aparte del motor: se despliega en su propio contenedor/Lambda, sin red
de salida y sin credenciales (ver README). Solo lo llama el servidor de Next.js.

Variables de entorno:
  CAD_SANDBOX_API_KEY   si está definida, se exige en la cabecera `X-API-Key`.
  CAD_SANDBOX_TIEMPO_S, CAD_SANDBOX_CPU_S, CAD_SANDBOX_MEMORIA_MB,
  CAD_SANDBOX_ARCHIVO_MB   límites del proceso hijo (ver `ejecutor.py`).
"""

from __future__ import annotations

import base64
import binascii
import hmac
import os
from pathlib import Path
from typing import Any

import structlog
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from motor import bitacora

from . import VERSION
from .ejecutor import ejecutar
from .render import ErrorRender, renderizar_glb
from .verificador import MAX_CARACTERES

bitacora.configurar("sandbox")
registro = structlog.get_logger("sandbox.api")

app = FastAPI(title="Sandbox CAD Plexiacril", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)
bitacora.instalar(app)

#: Raíz de las referencias de VibeCAD que se sirven al LLM.
RAIZ_REFERENCIAS = (Path(__file__).resolve().parent.parent / "skills" / "vibecad").resolve()
EXTENSIONES_REFERENCIA = {".md", ".py"}


class SolicitudCodigo(BaseModel):
    model_config = ConfigDict(extra="ignore")

    codigo: str = Field(min_length=1, max_length=MAX_CARACTERES)


class OpcionesDxf(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kerf_mm: float = Field(0, ge=0, le=5)
    separacion_mm: float = Field(5, ge=0, le=500)


class SolicitudDxf(SolicitudCodigo):
    opciones: OpcionesDxf = Field(default_factory=OpcionesDxf)


class EntradaPiezaPlancha(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=64)
    indice: int = Field(ge=1, le=10000)
    x_mm: float
    y_mm: float
    rotada: bool = False


class EntradaPlancha(BaseModel):
    model_config = ConfigDict(extra="ignore")

    ancho_mm: float = Field(gt=0, le=10000)
    alto_mm: float = Field(gt=0, le=10000)
    #: Rótulo de la plancha en el DXF («Cristal 3 mm»): solo referencia, no se corta.
    etiqueta: str | None = Field(None, max_length=120)
    piezas: list[EntradaPiezaPlancha] = Field(default_factory=list, max_length=2000)


class OpcionesDxfPlanchas(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kerf_mm: float = Field(0, ge=0, le=5)
    #: Solo algunas planchas del diseño (un grupo de material y espesor): pueden faltar copias.
    parcial: bool = False


class SolicitudDxfPlanchas(SolicitudCodigo):
    """Mismo acomodo que `/dxf/planchas` del motor, pero las piezas salen de ejecutar el código."""

    opciones: OpcionesDxfPlanchas = Field(default_factory=OpcionesDxfPlanchas)
    planchas: list[EntradaPlancha] = Field(min_length=1, max_length=200)


class SolicitudRender(BaseModel):
    model_config = ConfigDict(extra="ignore")

    glb_base64: str | None = Field(default=None, max_length=60 * 1024 * 1024)
    codigo: str | None = Field(default=None, max_length=MAX_CARACTERES)


def _error(estado: int, codigo: str, mensaje: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=estado, detail={"codigo": codigo, "mensaje": mensaje, **extra})


@app.exception_handler(RequestValidationError)
async def _cuerpo_invalido(request: Request, error: RequestValidationError) -> JSONResponse:
    errores = [
        {"campo": ".".join(str(p) for p in e.get("loc", ()) if p != "body"), "mensaje": str(e.get("msg", ""))}
        for e in error.errors()
    ]
    bitacora.anotar_error(
        request,
        codigo="parametros_invalidos",
        errores=[{**err, "tipo": e.get("type")} for err, e in zip(errores, error.errors())],
    )
    return JSONResponse(
        status_code=422,
        content={
            "detail": {"codigo": "parametros_invalidos", "mensaje": "La petición no tiene la forma esperada.", "errores": errores}
        },
    )


@app.exception_handler(Exception)
async def _fallo(request: Request, error: Exception) -> JSONResponse:
    registro.exception("fallo_no_previsto", metodo=request.method, ruta=request.url.path)
    return JSONResponse(status_code=500, content={"detail": {"codigo": "interno", "mensaje": "Fallo interno del sandbox."}})


def exigir_clave(x_api_key: str | None = Header(default=None)) -> None:
    esperada = os.environ.get("CAD_SANDBOX_API_KEY", "")
    if not esperada:
        return
    if not x_api_key or not hmac.compare_digest(x_api_key.encode(), esperada.encode()):
        raise _error(401, "no_autorizado", "Falta la cabecera X-API-Key o no es válida.")


protegido = [Depends(exigir_clave)]


def _error_codigo(datos: dict[str, Any], codigo_fuente: str) -> HTTPException:
    """Error del código del usuario → 422 con el detalle estructurado para el LLM."""
    error = datos.get("error") or {}
    return _error(
        422,
        "codigo_invalido",
        str(error.get("mensaje") or "El código no produjo un diseño."),
        error={k: v for k, v in error.items() if v not in (None, "")},
        codigo_fuente=codigo_fuente,
    )


@app.get("/salud")
def salud() -> dict[str, Any]:
    return {"ok": True, "version": VERSION}


@app.post("/ejecutar", dependencies=protegido)
async def ejecutar_codigo(solicitud: SolicitudCodigo) -> dict[str, Any]:
    r = await run_in_threadpool(ejecutar, solicitud.codigo, "generar")
    if not r.ok:
        raise _error_codigo(r.datos, solicitud.codigo)
    d = r.datos
    return {
        "codigo": solicitud.codigo,
        "nombre": d.get("nombre"),
        "dimensiones": d.get("dimensiones"),
        "glb_base64": d.get("glb_base64"),
        "piezas": d.get("piezas"),
        "validaciones": d.get("validaciones"),
        "salida": d.get("salida") or "",
    }


@app.post("/dxf", dependencies=protegido)
async def dxf(solicitud: SolicitudDxf) -> Response:
    r = await run_in_threadpool(ejecutar, solicitud.codigo, "dxf", solicitud.opciones.model_dump())
    if not r.ok or r.binario is None:
        raise _error_codigo(r.datos, solicitud.codigo)
    return Response(
        content=r.binario,
        media_type="application/dxf",
        headers={"Content-Disposition": 'attachment; filename="diseno-libre.dxf"'},
    )


@app.post("/dxf/planchas", dependencies=protegido)
async def dxf_planchas(solicitud: SolicitudDxfPlanchas) -> Response:
    opciones = {
        "kerf_mm": solicitud.opciones.kerf_mm,
        "parcial": solicitud.opciones.parcial,
        "planchas": [p.model_dump() for p in solicitud.planchas],
    }
    r = await run_in_threadpool(ejecutar, solicitud.codigo, "dxf_planchas", opciones)
    if not r.ok and isinstance(r.datos.get("acomodo"), dict):
        acomodo = r.datos["acomodo"]
        raise _error(
            422,
            "acomodo_invalido",
            str(acomodo.get("mensaje") or "El acomodo en planchas no es válido."),
            errores=acomodo.get("errores") or [],
        )
    if not r.ok or r.binario is None:
        raise _error_codigo(r.datos, solicitud.codigo)
    return Response(
        content=r.binario,
        media_type="application/dxf",
        headers={"Content-Disposition": 'attachment; filename="diseno-libre-planchas.dxf"'},
    )


@app.post("/step", dependencies=protegido)
async def step(solicitud: SolicitudCodigo) -> Response:
    r = await run_in_threadpool(ejecutar, solicitud.codigo, "step")
    if not r.ok or r.binario is None:
        raise _error_codigo(r.datos, solicitud.codigo)
    return Response(
        content=r.binario,
        media_type="application/step",
        headers={"Content-Disposition": 'attachment; filename="diseno-libre.step"'},
    )


@app.post("/render", dependencies=protegido)
async def render(solicitud: SolicitudRender) -> dict[str, Any]:
    if solicitud.glb_base64:
        try:
            glb = base64.b64decode(solicitud.glb_base64, validate=True)
        except (binascii.Error, ValueError) as e:
            raise _error(422, "parametros_invalidos", "glb_base64 no es base64 válido.") from e
    elif solicitud.codigo:
        r = await run_in_threadpool(ejecutar, solicitud.codigo, "generar")
        if not r.ok:
            raise _error_codigo(r.datos, solicitud.codigo)
        glb = base64.b64decode(r.datos["glb_base64"])
    else:
        raise _error(422, "parametros_invalidos", "Envíe glb_base64 o codigo.")
    try:
        png = await run_in_threadpool(renderizar_glb, glb)
    except ErrorRender as e:
        raise _error(422, "glb_invalido", str(e)) from e
    return {
        "png_base64": base64.b64encode(png).decode("ascii"),
        "vistas": ["isometrica", "frente", "planta", "lateral"],
        "ancho": 960,
        "alto": 960,
    }


def _referencias() -> list[Path]:
    salida = []
    for ruta in sorted(RAIZ_REFERENCIAS.rglob("*")):
        if ruta.is_file() and ruta.suffix in EXTENSIONES_REFERENCIA and not ruta.is_symlink():
            salida.append(ruta)
    return salida


def _nombre_referencia(ruta: Path) -> str:
    return ruta.relative_to(RAIZ_REFERENCIAS).as_posix()


@app.get("/referencias", dependencies=protegido)
def referencias() -> list[dict[str, Any]]:
    return [{"nombre": _nombre_referencia(r), "bytes": r.stat().st_size} for r in _referencias()]


@app.get("/referencias/{nombre:path}", dependencies=protegido)
def referencia(nombre: str) -> PlainTextResponse:
    # Solo nombres que estén en la lista: nada de rutas construidas por el cliente.
    disponibles = {_nombre_referencia(r): r for r in _referencias()}
    ruta = disponibles.get(nombre)
    if ruta is None:
        # Permite también el nombre de archivo suelto si es único.
        coincidencias = [r for n, r in disponibles.items() if n.rsplit("/", 1)[-1] == nombre]
        ruta = coincidencias[0] if len(coincidencias) == 1 else None
    if ruta is None:
        raise _error(404, "referencia_desconocida", f"No existe la referencia «{nombre}».")
    return PlainTextResponse(ruta.read_text(encoding="utf-8", errors="replace")[:200_000])
