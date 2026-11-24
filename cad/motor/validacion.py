"""
Comprobaciones sobre un diseño. Devuelven las `validaciones` del contrato:
`{ nivel: "error" | "aviso", codigo, mensaje, pieza? }`.

  solido_invalido           error  el sólido de una pieza no es válido
  interferencia             error  dos piezas armadas ocupan el mismo volumen
  dimensiones_no_coinciden  error  el conjunto armado no mide lo que se pidió
                                   (aviso si alguna copia tiene espesor propio)
  espesor_cambiado          aviso  una copia con espesor propio: las uniones no se reajustan
  pared_delgada             aviso  pieza más angosta que dos veces su espesor
  (más los avisos propios de cada plantilla)

Si una pieza entra o no en la plancha no se mira aquí: depende del material
elegido y de los formatos del catálogo, que conoce la app (`planchasDelDiseno`
en `lib/cad/materiales.ts`). Antes había un `excede_plancha` contra un tamaño
fijo (2440 × 1220) que daba errores falsos con planchas más grandes.
"""

from __future__ import annotations

import os
from itertools import combinations
from typing import Any

from .plantillas.base import Diseno, Instancia

#: Ancho máximo de una fila del DXF simple (`exportar.acomodar`), en mm. Se cambia con CAD_PLANCHA_MAX_MM="2440x1220".
PLANCHA_MAX_MM = (2440.0, 1220.0)
#: Volumen compartido (mm³) por debajo del cual dos piezas solo se tocan.
TOLERANCIA_VOLUMEN = 1e-3
#: Diferencia admitida (mm) entre las medidas pedidas y las del conjunto armado.
TOLERANCIA_MEDIDA = 0.01


def plancha_maxima() -> tuple[float, float]:
    texto = os.environ.get("CAD_PLANCHA_MAX_MM", "").lower().replace(" ", "")
    if texto:
        try:
            a, b = (float(v) for v in texto.split("x"))
            if a > 0 and b > 0:
                return (max(a, b), min(a, b))
        except ValueError:
            pass
    return PLANCHA_MAX_MM


def volumen_comun(a: Instancia, b: Instancia) -> float:
    """Volumen que comparten dos piezas armadas (0 si solo se tocan)."""
    ca, cb = a.solido.bounding_box(), b.solido.bounding_box()
    for eje in "XYZ":
        if getattr(ca.max, eje) <= getattr(cb.min, eje) + 1e-6 or getattr(cb.max, eje) <= getattr(ca.min, eje) + 1e-6:
            return 0.0
    comun = a.solido.intersect(b.solido)
    if comun is None:
        return 0.0
    formas = comun if isinstance(comun, (list, tuple)) else [comun]
    return float(sum(getattr(f, "volume", 0.0) or 0.0 for f in formas))


def interferencias(diseno: Diseno) -> list[tuple[str, str, float]]:
    """Pares de instancias que se pisan: (nombre, nombre, volumen)."""
    salida = []
    for a, b in combinations(diseno.instancias, 2):
        v = volumen_comun(a, b)
        if v > TOLERANCIA_VOLUMEN:
            salida.append((a.nombre, b.nombre, v))
    return salida


def validar(diseno: Diseno) -> list[dict[str, Any]]:
    salida: list[dict[str, Any]] = []

    for inst in diseno.instancias:
        if not inst.solido.is_valid or inst.solido.volume <= 0:
            salida.append(
                {
                    "nivel": "error",
                    "codigo": "solido_invalido",
                    "mensaje": f"La geometría de «{inst.pieza.nombre}» no es un sólido válido.",
                    "pieza": inst.pieza.id,
                }
            )

    for nombre_a, nombre_b, volumen in interferencias(diseno):
        salida.append(
            {
                "nivel": "error",
                "codigo": "interferencia",
                "mensaje": f"Las piezas «{nombre_a}» y «{nombre_b}» se pisan ({volumen:.2f} mm³ en común).",
                "pieza": nombre_a,
            }
        )

    for pieza in diseno.piezas:
        menor = min(pieza.ancho_mm, pieza.alto_mm)
        if menor < 2 * pieza.espesor_mm - 1e-9:
            salida.append(
                {
                    "nivel": "aviso",
                    "codigo": "pared_delgada",
                    "mensaje": (
                        f"«{pieza.nombre}» tiene {menor:.1f} mm de ancho, menos de dos veces su espesor "
                        f"({pieza.espesor_mm:g} mm): es frágil y difícil de pegar."
                    ),
                    "pieza": pieza.id,
                }
            )

    esperadas = diseno.plantilla.dimensiones_esperadas
    if esperadas is not None:
        pedido = esperadas(diseno.parametros)
        real = diseno.dimensiones()
        difs = [abs(real[eje] - pedido[i]) for i, eje in enumerate("xyz")]
        if max(difs) > TOLERANCIA_MEDIDA:
            salida.append(
                {
                    # Con espesores propios el conjunto cambia de medidas a propósito.
                    "nivel": "aviso" if diseno.espesores else "error",
                    "codigo": "dimensiones_no_coinciden",
                    "mensaje": (
                        f"El conjunto armado mide {real['x']:g} × {real['y']:g} × {real['z']:g} mm y se pidió "
                        f"{pedido[0]:g} × {pedido[1]:g} × {pedido[2]:g} mm."
                    ),
                }
            )

    if diseno.espesores:
        for pieza in diseno.piezas:
            cambiados = [n for n in pieza.nombres_nodo() if n in diseno.espesores]
            if not cambiados:
                continue
            copias = "" if pieza.cantidad == 1 else f" ({len(cambiados)} copia{'s' if len(cambiados) > 1 else ''})"
            salida.append(
                {
                    "nivel": "aviso",
                    "codigo": "espesor_cambiado",
                    "mensaje": (
                        f"«{pieza.nombre}»{copias} es de {pieza.espesor_mm:g} mm, distinto del espesor del diseño: "
                        "las uniones y las medidas de las piezas vecinas no se reajustan."
                    ),
                    "pieza": pieza.id,
                }
            )

    if diseno.plantilla.avisos is not None:
        salida.extend(diseno.plantilla.avisos(diseno.parametros))

    return salida
