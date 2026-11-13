"""El esquema que se publica es plano, como pide el contrato."""

from __future__ import annotations

import json
from enum import Enum
from typing import Literal, Optional

import pytest
from pydantic import BaseModel, Field

from motor.plantillas import describir, listar, obtener
from motor.plantillas.base import FAMILIAS, Parametros
from motor.plantillas.registro import EsquemaNoPlano, esquema_plano

CLAVES = {"type", "title", "description", "default", "minimum", "maximum", "enum", "minLength", "maxLength"}


@pytest.mark.parametrize("plantilla", listar(), ids=lambda p: p.codigo)
def test_esquema_plano(plantilla):
    d = describir(plantilla)
    assert set(d) == {"codigo", "nombre", "familia", "version", "descripcion", "esquema"}
    assert d["familia"] in FAMILIAS
    esquema = d["esquema"]
    texto = json.dumps(esquema)
    for prohibido in ("$ref", "$defs", "anyOf", "allOf", "oneOf", "const"):
        assert prohibido not in texto
    assert esquema["type"] == "object" and esquema["required"] == []
    for nombre, prop in esquema["properties"].items():
        assert set(prop) <= CLAVES, nombre
        assert {"type", "title", "description", "default"} <= set(prop), nombre
        assert prop["type"] in {"number", "integer", "boolean", "string"}
        if prop["type"] == "string" and "enum" in prop:
            assert prop["enum"] and prop["default"] in prop["enum"]
        elif prop["type"] == "string":  # texto libre: siempre con largo máximo
            assert 0 < len(prop["default"]) <= prop["maxLength"]
        if prop["type"] in {"number", "integer"}:
            assert prop["minimum"] <= prop["default"] <= prop["maximum"]
    # los valores por defecto forman un diseño válido
    assert plantilla.disenar({}).piezas


def test_esquema_de_la_caja():
    props = describir(obtener("caja"))["esquema"]["properties"]
    assert props["largo"] == {
        "type": "number",
        "title": "Largo",
        "description": "Medida exterior de frente, en mm (eje X).",
        "default": 200,
        "minimum": 20,
        "maximum": 2400,
    }
    assert props["tipo_union"]["enum"] == ["a_tope", "encastre"]
    assert props["con_tapa"]["type"] == "boolean"


class _Color(str, Enum):
    rojo = "rojo"
    azul = "azul"


def test_aplana_enums_y_literales_de_una_opcion():
    class P(Parametros):
        color: _Color = Field(_Color.rojo, title="Color", description="Color.")
        unico: Literal["solo"] = Field("solo", title="Único", description="Una opción.")

    props = esquema_plano(P)["properties"]
    assert props["color"]["type"] == "string" and props["color"]["enum"] == ["rojo", "azul"]
    assert props["unico"]["enum"] == ["solo"]
    assert "$ref" not in json.dumps(props)


def test_rechaza_campos_que_no_son_planos():
    class Anidado(BaseModel):
        x: float = 1

    class ConObjeto(Parametros):
        dentro: Anidado = Field(Anidado(), title="Dentro", description="Objeto.")

    class Opcional(Parametros):
        x: Optional[float] = Field(None, title="X", description="Opcional.")

    class TextoLibre(Parametros):
        t: str = Field("hola", title="T", description="Texto libre.")

    class SinTitulo(Parametros):
        x: float = Field(1, description="Sin título.")

    for modelo in (ConObjeto, Opcional, TextoLibre):
        with pytest.raises(EsquemaNoPlano):
            esquema_plano(modelo)
    # pydantic pone un título automático; la descripción sí es obligatoria
    assert esquema_plano(SinTitulo)["properties"]["x"]["title"] == "X"

    class SinDescripcion(Parametros):
        x: float = Field(1, title="X")

    with pytest.raises(EsquemaNoPlano):
        esquema_plano(SinDescripcion)


def test_admite_texto_libre_con_largo_maximo():
    class ConTexto(Parametros):
        t: str = Field("hola", title="T", description="Texto libre.", min_length=1, max_length=20)

    assert esquema_plano(ConTexto)["properties"]["t"] == {
        "type": "string",
        "title": "T",
        "description": "Texto libre.",
        "default": "hola",
        "minLength": 1,
        "maxLength": 20,
    }
