# Motor CAD — contrato de la API

Servicio Python (FastAPI + build123d) en `cad/`. No tiene base de datos ni
usuarios: recibe una plantilla y sus parámetros y devuelve geometría. Solo lo
llama el servidor de Next.js (`lib/cad/motor.ts`), nunca el navegador.

- Base: `CAD_API_BASE_URL` (en local `http://localhost:8001`).
- Autenticación: cabecera `X-API-Key: $CAD_API_KEY`. Sin ella, 401. Si el
  servicio arranca sin `CAD_API_KEY` definida, no exige cabecera (solo local).
- **Todas las medidas van en milímetros.** La app guarda centímetros en el
  catálogo; quien cruza la frontera convierte.
- JSON en `snake_case`, textos en español.

## `GET /salud`
`{ "ok": true, "version": "0.1.0" }` — no pide API key.

## `GET /plantillas`
Lista de `Plantilla`:

```json
{
  "codigo": "caja",
  "nombre": "Caja",
  "familia": "cajas",
  "version": 1,
  "descripcion": "Caja rectangular de piezas planas pegadas.",
  "esquema": { "type": "object", "properties": { "...": {} }, "required": [] }
}
```

`esquema` es JSON Schema (el que genera pydantic). Cada propiedad trae `title`,
`description`, `default` y, si aplica, `minimum`, `maximum`, `enum`. Solo se usan
tipos planos: `number`, `integer`, `boolean`, `string` con `enum`, o `string`
de texto libre con `maxLength` (y `minLength` opcional). Sin objetos
anidados ni `$ref`: el formulario de la app se genera a partir de aquí.

Familias: `anforas`, `cajas`, `displays`, `porta_afiches`, `letras`,
`alzadores`, `tarecos`, `letreros`, `atriles`.

## `GET /plantillas/{codigo}`
Una `Plantilla`. 404 si no existe.

## `POST /generar`
Entrada: `{ "plantilla": "caja", "parametros": { "largo": 200 } }`. Los parámetros
que falten toman su valor por defecto.

Salida:

```json
{
  "plantilla": "caja",
  "version_plantilla": 1,
  "parametros": { "largo": 200, "ancho": 150, "...": "ya normalizados" },
  "dimensiones": { "x": 200, "y": 150, "z": 100 },
  "glb_base64": "...",
  "piezas": [
    {
      "id": "base",
      "nombre": "Base",
      "cantidad": 1,
      "espesor_mm": 3,
      "ancho_mm": 200,
      "alto_mm": 150,
      "area_mm2": 30000,
      "perimetro_mm": 700,
      "nodos": ["base"],
      "origen": "base"
    }
  ],
  "validaciones": [
    { "nivel": "aviso", "codigo": "pared_delgada", "mensaje": "…", "pieza": "base" }
  ]
}
```

- `glb_base64`: glTF binario del conjunto armado. Un nodo por instancia de
  pieza, con nombre `<id>` o `<id>_<n>` si la pieza se repite. Unidades y ejes
  los del estándar glTF (metros, Y arriba). Cada nodo lleva en `extras`
  `{ pieza, origen, nodo, espesor_mm }`: el `id` de su pieza en el despiece, la
  pieza de la plantilla de la que salió, su nombre de nodo y su espesor.
- `piezas`: despiece plano. `ancho_mm` × `alto_mm` es la caja envolvente de la
  pieza acostada; `cantidad` agrupa las idénticas. `nodos`: el nombre en el GLB
  de cada copia (en el orden de `indice`); `origen`: la pieza de la plantilla.
- `validaciones`: `nivel` es `"error"` o `"aviso"`. Con algún `error` el diseño
  no se debe exportar a producción.

### Espesor por copia
Cualquier plantilla acepta, además de sus parámetros, `"espesor@<nodo>": mm`
(1 a 30): el espesor propio de una copia de pieza, por su nombre de nodo
(`"espesor@lateral_2": 5`). El motor lo aplica después de construir la
plantilla:

- La copia conserva su cara interior (la que mira al centro del conjunto) y
  crece hacia fuera; si es perpendicular a esa dirección (un divisor), crece
  por igual a los dos lados. Las uniones con las piezas vecinas no se reajustan.
- Si las copias de una pieza quedan con espesores distintos, se separan en el
  despiece: las que difieren de la copia 1 forman la pieza `<id>__<e>mm`
  (`lateral__5mm`, `lateral__5_5mm`), con nombre «Lateral (5 mm)». Los nombres
  de nodo del GLB no cambian.
- `parametros` devuelve solo los que se aplicaron: los de nodos que ya no
  existen o iguales al espesor de la plantilla se descartan.
- Validaciones: un aviso `espesor_cambiado` por pieza; `dimensiones_no_coinciden`
  pasa a aviso (el conjunto cambia de medidas a propósito).
- Un valor fuera de rango o una clave mal formada: 422 con `campo` = la clave.

## `POST /dxf`
Entrada: la de `/generar` más `"opciones": { "kerf_mm": 0, "separacion_mm": 5 }`
(opcional). Devuelve `application/dxf`: todas las piezas acostadas, sin
solaparse, en mm, con curvas reales. Capas: `CORTE` (color 1) y `GRABADO`
(color 3), las mismas de `lib/cortes/dxf.ts`.

## `POST /dxf/planchas`
El DXF de producción: las piezas ya acomodadas en las planchas reales del
catálogo (el acomodo lo calcula la app, `lib/cad/acomodo.ts`). Entrada: la de
`/generar` más

```json
{
  "opciones": { "kerf_mm": 0.2, "parcial": false },
  "planchas": [
    {
      "ancho_mm": 1220,
      "alto_mm": 1830,
      "etiqueta": "Acrílico ECO · Cristal · 3 mm",
      "piezas": [ { "id": "base", "indice": 1, "x_mm": 0, "y_mm": 1680, "rotada": false } ]
    }
  ]
}
```

- `indice`: qué copia de la pieza es, de 1 a su `cantidad`.
- `x_mm`, `y_mm`: esquina inferior izquierda de la caja nominal (sin kerf) de
  la pieza ya girada, en coordenadas de la plancha (origen abajo a la
  izquierda, Y hacia arriba, como el DXF).
- `rotada`: girada 90° en sentido antihorario.
- `etiqueta` (opcional): el rótulo de la plancha en el DXF (`TEXT` en la capa
  `PLANCHA`, debajo: «Plancha 1 - …»). Sin ella, el espesor.
- `parcial`: solo las planchas de un grupo (un material y espesor): pueden
  faltar copias. Sin él, tienen que estar todas.
- En una plancha todas las piezas tienen que ser del mismo espesor.

Devuelve `application/dxf` (R12, mm): cada plancha en la capa `PLANCHA`
(color 8), una al lado de la otra y separadas 50 mm como en
`lib/cortes/dxf.ts`, con los contornos reales en `CORTE` (con kerf) y
`GRABADO`. Cada copia de cada pieza tiene que aparecer exactamente una vez y
caer dentro de su plancha; si no, 422 con `codigo: "acomodo_invalido"` y la
lista de `errores` (`campo` como `planchas.0.piezas.3`).

## `POST /step`
Entrada: la de `/generar`. Devuelve `application/step` con el conjunto armado.

## Errores
- 401 sin API key válida.
- 404 plantilla desconocida.
- 422 acomodo inválido en `/dxf/planchas` (`codigo: "acomodo_invalido"`).
- 422 parámetros inválidos:
  `{ "detail": { "codigo": "parametros_invalidos", "mensaje": "…", "errores": [ { "campo": "largo", "mensaje": "…" } ] } }`
- 500 fallo de geometría: `{ "detail": { "codigo": "geometria", "mensaje": "…" } }`

## Diseño libre (sandbox, servicio aparte)
Servicio `cad/sandbox/` (local: `uv run uvicorn sandbox.api:app --port 8002`;
seguridad y despliegue en `cad/sandbox/README.md`). Cabecera `X-API-Key` si
`CAD_SANDBOX_API_KEY` está definida. Ejecuta código build123d del LLM que asigna
`piezas = [pieza(...), ...]` (módulo `diseno`, sobre `motor/plantillas/base.py`).

- `POST /ejecutar {codigo}` → lo de `/generar` sin `plantilla`/`parametros`:
  `{ codigo, nombre, dimensiones, glb_base64, piezas, validaciones, salida }`.
- `POST /dxf {codigo, opciones?: {kerf_mm, separacion_mm}}` → `application/dxf`.
- `POST /dxf/planchas {codigo, planchas, opciones?: {kerf_mm}}` → `application/dxf`:
  ejecuta el código y dibuja sus piezas en las planchas, igual que
  `/dxf/planchas` del motor (mismas `planchas`, capa `PLANCHA`). Acomodo que no
  cuadra con las piezas: 422 `acomodo_invalido` con `errores`.
- `POST /step {codigo}` → `application/step`.
- `POST /render {glb_base64 | codigo}` → `{ png_base64, vistas, ancho, alto }`
  (PNG 960×960: isométrica, frente, planta, lateral).
- `GET /referencias` → `[{nombre, bytes}]`; `GET /referencias/{nombre}` → texto
  (solo nombres de esa lista; 404 si no).
- Error del código: 422
  `{ "detail": { "codigo": "codigo_invalido", "mensaje": "…", "error": { "tipo": "sintaxis|prohibido|ejecucion|tiempo|memoria|contrato|geometria|salida", "mensaje": "…", "linea": 3, "traza": "…" }, "codigo_fuente": "…" } }`.
