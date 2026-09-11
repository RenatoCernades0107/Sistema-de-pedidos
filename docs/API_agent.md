# Quote Agent API

API HTTP para el asistente interno de cotizaciones de Manito Vidrios y Acrílicos. Un colaborador abre uno o varios chats (como ChatGPT), le pide una cotización en lenguaje natural, el agente arma un bosquejo de precios contra Odoo/el catálogo y pide confirmación explícita antes de crear la cotización (`sale.order` en estado `draft`) en Odoo.

FastAPI expone también Swagger interactivo en `/docs` y el esquema OpenAPI en `/openapi.json` sobre la misma base URL — útil para explorar tipos exactos, pero este documento es la referencia rápida para integrar el frontend.

## Base URL

- Local: `http://localhost:8000`
- Deploy (AWS API Gateway): la URL que entregue `serverless deploy` (`quote-agent-api-{stage}`).

## Autenticación

Todas las rutas requieren dos headers en cada request:

| Header | Descripción |
|---|---|
| `X-API-Key` | Secreto compartido de esta API (`APP_API_KEY` del `.env`). Si falta o es incorrecto → `401`. |
| `X-User-Id` | Id del colaborador logueado en tu web (tu backend ya lo conoce — esta API no implementa login propio). Si falta → `400`. Los chats están scoped a este id: un usuario no puede ver ni escribir en chats de otro (`404` si intenta). |

No hay noción de "cliente final" en la autenticación — el `X-User-Id` es siempre el colaborador interno que está cotizando, no el cliente al que se le cotiza (ese dato se pide dentro de la conversación, como RUC/DNI).

## Endpoints

### `POST /chats` — crear un chat nuevo

Body (opcional):
```json
{ "title": "Cotización cliente ACME" }
```
Si se omite `title`, queda `"Nueva cotización"` y se autocompleta con el primer mensaje del colaborador en cuanto llega.

Respuesta `200`:
```json
{
  "chat_id": "3f2a1e4e-...",
  "title": "Nueva cotización",
  "created_at": "2026-09-01T15:00:00+00:00",
  "updated_at": "2026-09-01T15:00:00+00:00",
  "last_quotation": null,
  "new_quotation": null
}
```

### `GET /chats` — listar los chats del colaborador (`X-User-Id`)

Respuesta `200`: array de chats, más recientes primero.
```json
[
  {
    "chat_id": "3f2a1e4e-...",
    "title": "cotízame 5 piezas de acrílico transparente 3mm 30x50cm",
    "created_at": "2026-09-01T15:00:00+00:00",
    "updated_at": "2026-09-01T15:02:30+00:00",
    "last_quotation": { "order_id": 55, "order_name": "SO0055", "total_pen": 118.0 },
    "new_quotation": null
  }
]
```
`last_quotation` es `null` hasta que ese chat efectivamente crea una cotización en Odoo.

`new_quotation` es el bosquejo *pendiente de confirmar* (todavía no creado en Odoo) — ver el detalle de cuándo es no-nulo en `POST /chats/{chat_id}/messages` más abajo. El frontend puede usarlo para mostrar el botón "Crear cotización en Odoo" (ver `POST /create-quotation`) en la lista de chats sin tener que abrir cada uno.

### `GET /chats/{chat_id}` — historial completo de un chat

Respuesta `200`:
```json
{
  "chat_id": "3f2a1e4e-...",
  "title": "cotízame 5 piezas de acrílico transparente 3mm 30x50cm",
  "created_at": "2026-09-01T15:00:00+00:00",
  "updated_at": "2026-09-01T15:02:30+00:00",
  "last_quotation": null,
  "new_quotation": {
    "partner_id": 42,
    "items": [{"product_product_id": 55, "qty": 5, "price_unit": 20.0}],
    "notes": "",
    "resumen": "5 piezas 30x50cm, ACRILICO F8 CRISTAL 3MM",
    "total_pen": 118.0
  },
  "messages": [
    { "role": "user", "text": "cotízame 5 piezas de acrílico transparente 3mm 30x50cm", "attachments": [] },
    { "role": "assistant", "text": "Bosquejo: 5 piezas de 30x50cm en ACRILICO F8 CRISTAL 3MM... Total: S/118.00. ¿Confirmas que cree esta cotización en Odoo?", "attachments": [] }
  ],
  "has_cut_sheet": false
}
```
`messages` solo trae texto humano/asistente — no expone tool calls ni resultados internos (precios intermedios, formatos evaluados, etc.).

`has_cut_sheet` dice si este chat puede entregar una hoja de corte (`GET /chats/{chat_id}/cut-sheet`): es `true` solo cuando ya creó una cotización en Odoo **y** esa cotización incluyó corte a medida. El PDF de la cotización no necesita un flag equivalente — está disponible exactamente cuando `last_quotation` no es `null`.

`404` si el chat no existe o pertenece a otro `X-User-Id`.

### `POST /chats/{chat_id}/messages` — enviar un mensaje (endpoint central)

Body:
```json
{ "message": "cotízame 5 piezas de acrílico transparente de 3mm de 30x50cm" }
```

**Adjuntos.** El colaborador puede mandar planos, dibujos o listas de piezas junto con el mensaje, o en vez de él:
```json
{
  "message": "cotiza lo del plano",
  "attachments": [
    { "filename": "plano.pdf", "content_type": "application/pdf", "content_base64": "JVBERi0xLjQK..." }
  ]
}
```
- `message` y `attachments` son ambos opcionales, pero **al menos uno** tiene que venir: un body con mensaje vacío y sin archivos da `422`.
- Tipos admitidos: `application/pdf`, `image/png`, `image/jpeg`, `image/webp` — lo que Gemini sabe leer. Cualquier otro da `422` con el motivo, en vez de guardarse y ser ignorado en silencio.
- Máximo **10 archivos y 4 MB en total por mensaje** (sobre los bytes, antes del base64). El tope sale del límite de 6 MB del payload síncrono de Lambda.
- La validación es todo-o-nada: si un archivo falla no se guarda ninguno, para que no queden mensajes a medio subir.
- El agente **los lee en ese turno** (Gemini recibe el PDF o la imagen tal cual) y devuelve en `reply` lo que entendió, pieza por pieza, antes de poner precios.
- En turnos posteriores el modelo ya no recibe los bytes, solo el nombre del archivo: releerlo en cada turno costaría una fortuna y para entonces lo leído ya está en la conversación. Si hace falta volver a mirarlo, hay que adjuntarlo de nuevo.

Los bytes se guardan en S3, nunca en el historial: un chat es un único item de DynamoDB con tope de 400 KB, y una foto de un plano lo reventaría. Lo que viaja en `messages` es solo la ficha del archivo.

La respuesta incluye `attachments` con lo que quedó guardado:
```json
{
  "reply": "Del plano leí 4 piezas de 30x50cm en acrílico 3mm...",
  "last_quotation": null,
  "new_quotation": null,
  "has_cut_sheet": false,
  "attachments": [
    { "attachment_id": "9f2c...", "filename": "plano.pdf", "content_type": "application/pdf", "size": 148213, "uploaded_at": "2026-09-11T04:30:00+00:00" }
  ]
}
```

Respuesta `200`:
```json
{
  "reply": "Bosquejo: 5 piezas de 30x50cm en ACRILICO F8 CRISTAL 3MM... Total: S/118.00. ¿Confirmas que cree esta cotización en Odoo?",
  "last_quotation": null,
  "new_quotation": {
    "partner_id": 42,
    "items": [{"product_product_id": 55, "qty": 5, "price_unit": 20.0}],
    "notes": "",
    "resumen": "5 piezas 30x50cm, ACRILICO F8 CRISTAL 3MM",
    "total_pen": 118.0
  }
}
```

`reply` es texto libre en español — no hay un campo estructurado `pending_confirmation`. El frontend simplemente muestra el texto en el chat y deja que el colaborador responda libremente (confirmando, rechazando o pidiendo cambios) en su siguiente mensaje.

`new_quotation` es el bosquejo que el agente acaba de armar y presentar en `reply`, listo para ser confirmado — pero **todavía no creado en Odoo**. El frontend puede usarlo para mostrar un botón "Crear cotización en Odoo" que llama a `POST /create-quotation` (ver más abajo) como alternativa a que el colaborador escriba "sí, confirmo" en el chat.

Cuándo es no-nulo `new_quotation`: solo en el turno en que el agente presenta el bosquejo y pregunta "¿Confirmas que cree esta cotización en Odoo?", y solo cuando el precio ya está totalmente calculado **y** el RUC/DNI del cliente ya se resolvió a un partner en Odoo — nunca antes de tener ambas cosas.

Cuándo vuelve a `null`:
- En el turno en que la cotización efectivamente se crea en Odoo (ese turno trae `last_quotation` en vez de `new_quotation`).
- En cualquier turno donde el agente no vuelve a presentar/re-presentar un bosquejo — por ejemplo, si el colaborador cambia de tema, o si al agente todavía le falta un dato (sigue preguntando el RUC/DNI).
- Si el colaborador pide un cambio (color, cantidad, medida): el agente ajusta y vuelve a preguntar, lo cual genera un `new_quotation` **nuevo** (reemplaza al anterior) en ese mismo turno de re-confirmación.

Es decir, `new_quotation` nunca queda "pegado" de un turno viejo: cada respuesta refleja únicamente lo que pasó en ese turno.

`last_quotation` solo viene distinto de `null` en el turno exacto en que el agente creó la cotización en Odoo (después de una confirmación explícita del colaborador):
```json
{
  "reply": "Cotización SO0055 creada por S/118.00.",
  "last_quotation": { "order_id": 55, "order_name": "SO0055", "total_pen": 118.0 },
  "new_quotation": null,
  "has_cut_sheet": true
}
```

En ese mismo turno viene `has_cut_sheet`, para que el frontend pueda ofrecer los dos PDFs (cotización y hoja de corte) sin volver a pedir el chat. Ver `GET /chats/{chat_id}/quotation-pdf` y `GET /chats/{chat_id}/cut-sheet`.

Ejemplo de ida y vuelta completo:

1. `POST /chats` → `{chat_id}`
2. `POST /chats/{chat_id}/messages` con `"cotízame 5 piezas de acrílico transparente de 3mm de 30x50cm"` → el agente busca el producto, calcula el corte, arma el bosquejo y **pregunta si confirmas** (`last_quotation: null`, `new_quotation` con el bosquejo si ya se resolvió el RUC/DNI, si no todavía `null`).
3. Confirmación — dos formas equivalentes:
   - **En el chat**: `POST /chats/{chat_id}/messages` con `"sí, confirmo, RUC 20123456789"` (o lo que el agente haya pedido) → si falta el RUC/DNI del cliente el agente lo pide en este paso antes de crear la cotización; una vez que tiene todo, llama a Odoo y responde con el número de cotización (`last_quotation` con `order_id/order_name/total_pen`, `new_quotation: null`).
   - **Con el botón del frontend**: una vez que `new_quotation` no es `null` (ya se resolvió el RUC/DNI y el precio), `POST /create-quotation` con `{chat_id}` crea la cotización directamente sin pasar por el chat/LLM, con la misma respuesta que el paso anterior.
4. `POST /chats/{chat_id}/messages` con `"no, cámbialo a color bronce"` en el paso 3 en vez de confirmar → el agente ajusta y vuelve a preguntar (nuevo `new_quotation`); nunca crea la cotización sin una confirmación explícita.

`404` si el chat no existe o pertenece a otro `X-User-Id`.

### `GET /chats/{chat_id}/attachments/{attachment_id}` — un archivo que adjuntó el colaborador

Misma forma de respuesta que las otras rutas de documentos (`filename` / `content_type` / `content_base64`). Es lo que usa el frontend para volver a mostrar el plano en el hilo.

El `attachment_id` se resuelve **contra el historial de ese chat**, no contra S3 directamente: solo se puede nombrar un archivo que ese chat mandó de verdad, que es lo que impide que un id alcance el prefijo de otro chat. `404` si el id no está en el historial.

Al borrar un chat se borran también sus archivos. Si S3 falla en ese momento el chat se borra igual y quedan unos objetos inalcanzables: un botón de borrar que a veces se niega es peor.

### `GET /chats/{chat_id}/quotation-pdf` — el PDF de la cotización (tal como lo imprime Odoo)

Respuesta `200` — el PDF va en base64 dentro del JSON, no como `application/pdf` a secas:
```json
{
  "filename": "Cotizacion-S04254.pdf",
  "content_type": "application/pdf",
  "content_base64": "JVBERi0xLjQK..."
}
```

El motivo del base64: esta API vive detrás de API Gateway REST, que solo pasa binarios si se le declara `binaryMediaTypes`, y declararlo afecta a **todas** las rutas (las respuestas JSON del resto de la API empezarían a llegar en base64 también). Un PDF aquí pesa unos cientos de KB, así que el ~33% extra del base64 no justifica ese riesgo.

Se direcciona por `chat_id` y no por `order_id` a propósito: la única autorización que tiene esta API es la pertenencia del chat, así que una ruta que aceptara un id de orden de Odoo dejaría a cualquier llamador pasearse por las cotizaciones de otros colaboradores (y de otros clientes).

Errores: `404` si el chat no existe o es de otro `X-User-Id`; `409` si el chat todavía no creó ninguna cotización (`last_quotation: null`).

### `GET /chats/{chat_id}/cut-sheet` — la hoja de corte

Misma forma de respuesta que `quotation-pdf` (`filename` / `content_type` / `content_base64`), con `filename` tipo `"Hoja-de-corte-S04254.pdf"`. Es la misma hoja que el bot de WhatsApp le manda al taller: piezas pedidas, cálculo de precio y el diagrama de cada plancha con el acomodo de los cortes.

Se regenera a demanda desde el historial del chat (de ahí sale el `layout_json` del último cálculo de corte) más el cliente leído de la orden en Odoo. No se guarda nada: una cotización vieja también puede volver a bajar su hoja.

Errores: `404` si el chat no existe o es de otro `X-User-Id`; `409` si el chat no tiene cotización creada, o si la cotización no incluyó corte (plancha entera). Consulta `has_cut_sheet` para no ofrecer el botón en ese caso.

### `DELETE /chats/{chat_id}` — borrar un chat

Respuesta `204` sin body. `404` si no existe o no es del usuario.

### `POST /create-quotation` — confirmar y crear en Odoo el bosquejo pendiente

Ruta a nivel raíz (no bajo `/chats`). Requiere los mismos headers `X-API-Key` / `X-User-Id` que el resto de la API. Es la acción del botón "Crear cotización en Odoo" del frontend: confirma y crea directamente en Odoo el `new_quotation` actualmente pendiente de un chat, **sin pasar por el LLM**.

Body:
```json
{ "chat_id": "3f2a1e4e-..." }
```

Respuesta `200` — mismo shape que `POST /chats/{chat_id}/messages`:
```json
{
  "reply": "Cotización SO0055 creada por S/118.00.",
  "last_quotation": { "order_id": 55, "order_name": "SO0055", "total_pen": 118.0 },
  "new_quotation": null,
  "has_cut_sheet": true
}
```

La respuesta se agrega también al historial persistido del chat (como si fuera un turno más del agente), así que si el colaborador reabre el chat después, ve la confirmación en `messages`.

Errores:
- `404` si `chat_id` no existe o pertenece a otro `X-User-Id`.
- `409` si el chat no tiene actualmente un `new_quotation` pendiente (`null`) — no hay nada que confirmar.

## Códigos de error

| Código | Causa |
|---|---|
| `400` | Falta el header `X-User-Id`. |
| `401` | Falta `X-API-Key` o es incorrecto. |
| `404` | `chat_id` no existe, o existe pero pertenece a otro `X-User-Id`. |
| `409` | `POST /create-quotation`: no hay `new_quotation` pendiente para ese chat. Rutas de documentos: el chat no tiene cotización creada, o (en `cut-sheet`) la cotización no incluyó corte. |
| `422` | Body inválido (ej. falta `message` en `POST /messages`). |

## Seguridad — trust boundary de `X-User-Id`

`X-User-Id` **no está autenticado ni verificado** por esta API — es solo el scope con el que se filtran/aíslan los chats, asumiendo que quien lo envía es un llamador confiable (tu backend web, que ya posee `APP_API_KEY` y ya autenticó a su propio usuario antes de llamar). Cualquiera que tenga `APP_API_KEY` puede mandar cualquier `X-User-Id` y leer/editar/borrar los chats de otro colaborador (IDOR).

Esto es intencional para v1 (API key compartida, sin login propio en esta API), pero implica una regla dura de integración:

- **Nunca** expongas esta API directo al browser del colaborador pasando `X-User-Id` desde un valor que el usuario o el frontend puedan controlar libremente.
- Llama esta API **solo server-to-server**: tu backend web autentica al colaborador (su propio login/sesión) y recién ahí, desde tu servidor, hace la request a `/chats/*` con el `X-User-Id` que tu backend ya verificó.
- Si en el futuro este API se va a exponer directo a un cliente no confiable (browser, app móvil sin backend intermedio), hay que reemplazar este esquema por autenticación real por usuario (API key/JWT individual verificado en el servidor), no por un header de texto plano.

## Notas de integración

- El endpoint de mensajes es **síncrono**: la respuesta HTTP ya trae la respuesta completa del agente (puede tardar varios segundos porque internamente llama a Gemini y a Odoo varias veces). No hay streaming ni webhooks — un `POST` = un turno de chat completo.
- `message` acepta adjuntos (PDF e imágenes) — ver `POST /chats/{chat_id}/messages`.
- El `title` de un chat se autocompleta con los primeros ~60 caracteres del primer mensaje del colaborador si no se pasó uno explícito al crear el chat.
