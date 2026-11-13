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
tipos planos: `number`, `integer`, `boolean`, `string` con `enum`. Sin objetos
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
      "perimetro_mm": 700
    }
  ],
  "validaciones": [
    { "nivel": "aviso", "codigo": "pared_delgada", "mensaje": "…", "pieza": "base" }
  ]
}
```

- `glb_base64`: glTF binario del conjunto armado. Un nodo por instancia de
  pieza, con nombre `<id>` o `<id>_<n>` si la pieza se repite. Unidades y ejes
  los del estándar glTF (metros, Y arriba).
- `piezas`: despiece plano. `ancho_mm` × `alto_mm` es la caja envolvente de la
  pieza acostada; `cantidad` agrupa las idénticas.
- `validaciones`: `nivel` es `"error"` o `"aviso"`. Con algún `error` el diseño
  no se debe exportar a producción.

## `POST /dxf`
Entrada: la de `/generar` más `"opciones": { "kerf_mm": 0, "separacion_mm": 5 }`
(opcional). Devuelve `application/dxf`: todas las piezas acostadas, sin
solaparse, en mm, con curvas reales. Capas: `CORTE` (color 1) y `GRABADO`
(color 3), las mismas de `lib/cortes/dxf.ts`.

## `POST /step`
Entrada: la de `/generar`. Devuelve `application/step` con el conjunto armado.

## Errores
- 401 sin API key válida.
- 404 plantilla desconocida.
- 422 parámetros inválidos:
  `{ "detail": { "codigo": "parametros_invalidos", "mensaje": "…", "errores": [ { "campo": "largo", "mensaje": "…" } ] } }`
- 500 fallo de geometría: `{ "detail": { "codigo": "geometria", "mensaje": "…" } }`
