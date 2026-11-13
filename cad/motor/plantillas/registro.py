"""
Registro de plantillas (código → plantilla) y exportación de su esquema.

El esquema que se publica es JSON Schema **plano**: sin `$ref`, `$defs` ni
`anyOf`; los `Literal` salen como `enum`. El formulario de la app se genera a
partir de él, así que una plantilla con un campo que no se pueda aplanar no se
deja registrar.
"""

from __future__ import annotations

from typing import Any

from .base import FAMILIAS, Parametros, Plantilla

_PLANTILLAS: dict[str, Plantilla] = {}

_TIPOS = {"number", "integer", "boolean", "string"}
_CLAVES = ("type", "title", "description", "default", "minimum", "maximum", "enum")


class EsquemaNoPlano(ValueError):
    pass


def esquema_plano(modelo: type[Parametros]) -> dict[str, Any]:
    """JSON Schema plano de un modelo de parámetros."""
    bruto = modelo.model_json_schema()
    definiciones = bruto.get("$defs", {})
    propiedades: dict[str, Any] = {}
    for nombre, prop in bruto.get("properties", {}).items():
        propiedades[nombre] = _aplanar(nombre, prop, definiciones)
    return {
        "type": "object",
        "properties": propiedades,
        "required": list(bruto.get("required", [])),
    }


def _aplanar(nombre: str, prop: dict[str, Any], definiciones: dict[str, Any]) -> dict[str, Any]:
    p = dict(prop)
    # Un enum de Python sale como $ref (a veces dentro de allOf): se resuelve.
    for clave in ("allOf", "anyOf", "oneOf"):
        if clave in p:
            partes = p.pop(clave)
            if len(partes) != 1:
                raise EsquemaNoPlano(f"«{nombre}»: no se admiten uniones de tipos ({clave}).")
            p = {**partes[0], **p}
    if "$ref" in p:
        destino = definiciones.get(p.pop("$ref").split("/")[-1])
        if destino is None:
            raise EsquemaNoPlano(f"«{nombre}»: referencia sin resolver.")
        p = {**destino, **p}
    if "const" in p:
        p["enum"] = [p.pop("const")]
    if "exclusiveMinimum" in p or "exclusiveMaximum" in p:
        raise EsquemaNoPlano(f"«{nombre}»: use ge/le, no gt/lt (el esquema solo lleva minimum/maximum).")

    tipo = p.get("type")
    if tipo not in _TIPOS:
        raise EsquemaNoPlano(f"«{nombre}»: tipo «{tipo}» no admitido; solo {sorted(_TIPOS)}.")
    if tipo == "string" and not p.get("enum"):
        raise EsquemaNoPlano(f"«{nombre}»: un texto debe ser un Literal con sus opciones (enum).")
    if "enum" in p and not all(isinstance(v, str) for v in p["enum"]):
        raise EsquemaNoPlano(f"«{nombre}»: las opciones de un enum deben ser textos.")
    for obligatoria in ("title", "description", "default"):
        if obligatoria not in p:
            raise EsquemaNoPlano(f"«{nombre}»: falta «{obligatoria}».")
    return {clave: p[clave] for clave in _CLAVES if clave in p}


def registrar(plantilla: Plantilla) -> Plantilla:
    if plantilla.familia not in FAMILIAS:
        raise ValueError(f"Familia desconocida: «{plantilla.familia}».")
    if plantilla.codigo in _PLANTILLAS and _PLANTILLAS[plantilla.codigo] is not plantilla:
        raise ValueError(f"Ya hay una plantilla con el código «{plantilla.codigo}».")
    esquema_plano(plantilla.modelo)  # falla aquí si el modelo no es plano
    _PLANTILLAS[plantilla.codigo] = plantilla
    return plantilla


def obtener(codigo: str) -> Plantilla | None:
    return _PLANTILLAS.get(codigo)


def listar() -> list[Plantilla]:
    return list(_PLANTILLAS.values())


def describir(plantilla: Plantilla) -> dict[str, Any]:
    """La plantilla tal como viaja por la API."""
    return {
        "codigo": plantilla.codigo,
        "nombre": plantilla.nombre,
        "familia": plantilla.familia,
        "version": plantilla.version,
        "descripcion": plantilla.descripcion,
        "esquema": esquema_plano(plantilla.modelo),
    }
