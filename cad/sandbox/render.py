"""
Render liviano de un GLB a PNG, sin GPU ni navegador (Pillow + numpy).

Dibuja cuatro vistas en una sola imagen 2×2: isométrica, frente, planta y
lateral. Pintor simple: los triángulos se ordenan de lejos a cerca y se
rellenan con un sombreado plano según su normal; las aristas vivas (donde las
caras forman un ángulo marcado o donde termina la malla) se trazan junto con
cada triángulo, así las tapadas quedan cubiertas por los triángulos cercanos.

Lee solo GLB como los que escribe `motor.exportar.exportar_glb` (POSITION
float32 sin índices, modo TRIANGLES), con comprobación de tamaños.
"""

from __future__ import annotations

import io
import json
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFont

MAX_GLB = 40 * 1024 * 1024
MAX_TRIANGULOS = 400_000
LADO = 480
MARGEN = 28

COLORES = [
    (125, 186, 222),
    (240, 170, 110),
    (150, 205, 140),
    (215, 150, 200),
    (230, 210, 120),
    (160, 160, 225),
]

#: (título, dirección hacia la cámara, «arriba» en pantalla), en ejes CAD (Z arriba).
VISTAS = [
    ("Isométrica", (1.0, -1.0, 0.8), (0.0, 0.0, 1.0)),
    ("Frente", (0.0, -1.0, 0.0), (0.0, 0.0, 1.0)),
    ("Planta", (0.0, 0.0, 1.0), (0.0, 1.0, 0.0)),
    ("Lateral", (1.0, 0.0, 0.0), (0.0, 0.0, 1.0)),
]


class ErrorRender(ValueError):
    pass


def leer_mallas(glb: bytes) -> list[np.ndarray]:
    """Triángulos de cada malla del GLB, en mm y ejes CAD: lista de arrays (n, 3, 3)."""
    if len(glb) > MAX_GLB:
        raise ErrorRender("El GLB es demasiado grande.")
    if len(glb) < 20:
        raise ErrorRender("No es un GLB.")
    magia, version, total = struct.unpack_from("<4sII", glb, 0)
    if magia != b"glTF" or version != 2 or total > len(glb):
        raise ErrorRender("No es un GLB 2.0.")
    largo_json, tipo = struct.unpack_from("<I4s", glb, 12)
    if tipo != b"JSON" or 20 + largo_json > len(glb):
        raise ErrorRender("GLB sin bloque JSON.")
    gltf = json.loads(glb[20 : 20 + largo_json].decode("utf-8"))
    inicio_bin = 20 + largo_json
    binario = b""
    if inicio_bin + 8 <= len(glb):
        largo_bin, tipo_bin = struct.unpack_from("<I4s", glb, inicio_bin)
        if tipo_bin == b"BIN\x00":
            binario = glb[inicio_bin + 8 : inicio_bin + 8 + largo_bin]

    accesores = gltf.get("accessors", [])
    vistas = gltf.get("bufferViews", [])
    mallas: list[np.ndarray] = []
    total_tri = 0
    for malla in gltf.get("meshes", []):
        partes = []
        for prim in malla.get("primitives", []):
            if prim.get("mode", 4) != 4 or "indices" in prim:
                continue
            acc = accesores[int(prim["attributes"]["POSITION"])]
            if acc.get("componentType") != 5126 or acc.get("type") != "VEC3":
                continue
            vista = vistas[int(acc["bufferView"])]
            desde = int(vista.get("byteOffset", 0)) + int(acc.get("byteOffset", 0))
            n = int(acc["count"])
            if n % 3 or desde < 0 or desde + n * 12 > len(binario):
                raise ErrorRender("Accesor fuera del búfer.")
            total_tri += n // 3
            if total_tri > MAX_TRIANGULOS:
                raise ErrorRender("Demasiados triángulos para renderizar.")
            v = np.frombuffer(binario, dtype="<f4", count=n * 3, offset=desde).astype(np.float64).reshape(-1, 3)
            # glTF (m, Y arriba) → CAD (mm, Z arriba): (x, y, z) → (x, −z, y)·1000
            v = np.column_stack([v[:, 0], -v[:, 2], v[:, 1]]) * 1000.0
            partes.append(v.reshape(-1, 3, 3))
        if partes:
            mallas.append(np.concatenate(partes))
    if not mallas:
        raise ErrorRender("El GLB no tiene mallas de triángulos.")
    return mallas


def _aristas_vivas(tri: np.ndarray, normales: np.ndarray, angulo_grados: float = 20.0) -> list[list[int]]:
    """Para cada triángulo, qué lados (0,1,2) son aristas vivas."""
    clave = np.round(tri, 3)
    mapa: dict[tuple, list[tuple[int, int]]] = {}
    for t in range(len(tri)):
        for lado in range(3):
            a = tuple(clave[t, lado])
            b = tuple(clave[t, (lado + 1) % 3])
            k = (a, b) if a <= b else (b, a)
            mapa.setdefault(k, []).append((t, lado))
    umbral = np.cos(np.radians(angulo_grados))
    vivas: list[list[int]] = [[] for _ in range(len(tri))]
    for usos in mapa.values():
        if len(usos) == 1:
            t, lado = usos[0]
            vivas[t].append(lado)
            continue
        if len(usos) == 2:
            (t1, l1), (t2, l2) = usos
            if float(np.dot(normales[t1], normales[t2])) < umbral:
                vivas[t1].append(l1)
        else:
            t, lado = usos[0]
            vivas[t].append(lado)
    return vivas


def _base(direccion: tuple, arriba: tuple) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    d = np.array(direccion, dtype=float)
    d /= np.linalg.norm(d)
    u = np.array(arriba, dtype=float)
    derecha = np.cross(u, d)
    derecha /= np.linalg.norm(derecha)
    arriba_real = np.cross(d, derecha)
    return derecha, arriba_real, d


def _dibujar_vista(
    dibujo: ImageDraw.ImageDraw,
    caja: tuple[int, int, int, int],
    mallas: list[tuple[np.ndarray, np.ndarray, list[list[int]]]],
    direccion: tuple,
    arriba: tuple,
    titulo: str,
) -> None:
    x0, y0, x1, y1 = caja
    derecha, arr, d = _base(direccion, arriba)
    luz = np.array([0.4, -0.7, 1.0])
    luz /= np.linalg.norm(luz)

    todos = np.concatenate([m[0].reshape(-1, 3) for m in mallas])
    px = todos @ derecha
    py = todos @ arr
    ancho = max(px.max() - px.min(), 1e-6)
    alto = max(py.max() - py.min(), 1e-6)
    escala = min((x1 - x0 - 2 * MARGEN) / ancho, (y1 - y0 - 2 * MARGEN - 16) / alto)
    cx = (x0 + x1) / 2 - (px.min() + px.max()) / 2 * escala
    cy = (y0 + y1 + 16) / 2 + (py.min() + py.max()) / 2 * escala

    elementos = []
    for indice, (tri, normales, vivas) in enumerate(mallas):
        color = np.array(COLORES[indice % len(COLORES)], dtype=float)
        profundidad = (tri @ d).mean(axis=1)
        brillo = 0.45 + 0.55 * np.abs(normales @ luz)
        for t in range(len(tri)):
            elementos.append((profundidad[t], tri[t], tuple(int(c) for c in color * brillo[t]), vivas[t]))
    elementos.sort(key=lambda e: e[0])

    for _, t, color, vivas in elementos:
        pts = [(cx + float(p @ derecha) * escala, cy - float(p @ arr) * escala) for p in t]
        dibujo.polygon(pts, fill=color)
        for lado in vivas:
            dibujo.line([pts[lado], pts[(lado + 1) % 3]], fill=(30, 40, 55), width=1)

    dibujo.rectangle(caja, outline=(200, 200, 200))
    try:
        fuente = ImageFont.load_default(size=15)
    except Exception:  # noqa: BLE001 - Pillow sin FreeType: fuente de mapa de bits, sin tildes
        fuente = ImageFont.load_default()
        titulo = titulo.replace("é", "e")
    dibujo.text((x0 + 8, y0 + 6), titulo, fill=(40, 40, 40), font=fuente)


def renderizar_glb(glb: bytes, lado: int = LADO) -> bytes:
    """PNG 2×2 (isométrica, frente, planta, lateral) del GLB."""
    mallas_crudas = leer_mallas(glb)
    mallas = []
    for tri in mallas_crudas:
        normales = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        largo = np.linalg.norm(normales, axis=1)
        validos = largo > 1e-12
        tri, normales = tri[validos], normales[validos] / largo[validos][:, None]
        if len(tri):
            mallas.append((tri, normales, _aristas_vivas(tri, normales)))
    if not mallas:
        raise ErrorRender("El GLB no tiene triángulos válidos.")

    imagen = Image.new("RGB", (2 * lado, 2 * lado), (250, 250, 250))
    dibujo = ImageDraw.Draw(imagen)
    for i, (titulo, direccion, arriba) in enumerate(VISTAS):
        fila, col = divmod(i, 2)
        caja = (col * lado, fila * lado, (col + 1) * lado - 1, (fila + 1) * lado - 1)
        _dibujar_vista(dibujo, caja, mallas, direccion, arriba, titulo)
    salida = io.BytesIO()
    imagen.save(salida, format="PNG", optimize=True)
    return salida.getvalue()
