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
  "last_quotation": null
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
    "last_quotation": { "order_id": 55, "order_name": "SO0055", "total_pen": 118.0 }
  }
]
```
`last_quotation` es `null` hasta que ese chat efectivamente crea una cotización en Odoo.

### `GET /chats/{chat_id}` — historial completo de un chat

Respuesta `200`:
```json
{
  "chat_id": "3f2a1e4e-...",
  "title": "cotízame 5 piezas de acrílico transparente 3mm 30x50cm",
  "created_at": "2026-09-01T15:00:00+00:00",
  "updated_at": "2026-09-01T15:02:30+00:00",
  "last_quotation": null,
  "messages": [
    { "role": "user", "text": "cotízame 5 piezas de acrílico transparente 3mm 30x50cm" },
    { "role": "assistant", "text": "Bosquejo: 5 piezas de 30x50cm en ACRILICO F8 CRISTAL 3MM... Total: S/118.00. ¿Confirmas que cree esta cotización en Odoo?" }
  ]
}
```
`messages` solo trae texto humano/asistente — no expone tool calls ni resultados internos (precios intermedios, formatos evaluados, etc.).

`404` si el chat no existe o pertenece a otro `X-User-Id`.

### `POST /chats/{chat_id}/messages` — enviar un mensaje (endpoint central)

Body:
```json
{ "message": "cotízame 5 piezas de acrílico transparente de 3mm de 30x50cm" }
```

Respuesta `200`:
```json
{
  "reply": "Bosquejo: 5 piezas de 30x50cm en ACRILICO F8 CRISTAL 3MM... Total: S/118.00. ¿Confirmas que cree esta cotización en Odoo?",
  "last_quotation": null
}
```

`reply` es texto libre en español — no hay un campo estructurado `pending_confirmation`. El frontend simplemente muestra el texto en el chat y deja que el colaborador responda libremente (confirmando, rechazando o pidiendo cambios) en su siguiente mensaje.

`last_quotation` solo viene distinto de `null` en el turno exacto en que el agente creó la cotización en Odoo (después de una confirmación explícita del colaborador):
```json
{
  "reply": "Cotización SO0055 creada por S/118.00.",
  "last_quotation": { "order_id": 55, "order_name": "SO0055", "total_pen": 118.0 }
}
```

Ejemplo de ida y vuelta completo:

1. `POST /chats` → `{chat_id}`
2. `POST /chats/{chat_id}/messages` con `"cotízame 5 piezas de acrílico transparente de 3mm de 30x50cm"` → el agente busca el producto, calcula el corte, arma el bosquejo y **pregunta si confirmas** (`last_quotation: null`).
3. `POST /chats/{chat_id}/messages` con `"sí, confirmo, RUC 20123456789"` (o lo que el agente haya pedido) → si falta el RUC/DNI del cliente el agente lo pide en este paso antes de crear la cotización; una vez que tiene todo, llama a Odoo y responde con el número de cotización (`last_quotation` con `order_id/order_name/total_pen`).
4. `POST /chats/{chat_id}/messages` con `"no, cámbialo a color bronce"` en el paso 3 en vez de confirmar → el agente ajusta y vuelve a preguntar; nunca crea la cotización sin una confirmación explícita.

`404` si el chat no existe o pertenece a otro `X-User-Id`.

### `DELETE /chats/{chat_id}` — borrar un chat

Respuesta `204` sin body. `404` si no existe o no es del usuario.

## Códigos de error

| Código | Causa |
|---|---|
| `400` | Falta el header `X-User-Id`. |
| `401` | Falta `X-API-Key` o es incorrecto. |
| `404` | `chat_id` no existe, o existe pero pertenece a otro `X-User-Id`. |
| `422` | Body inválido (ej. falta `message` en `POST /messages`). |

## Seguridad — trust boundary de `X-User-Id`

`X-User-Id` **no está autenticado ni verificado** por esta API — es solo el scope con el que se filtran/aíslan los chats, asumiendo que quien lo envía es un llamador confiable (tu backend web, que ya posee `APP_API_KEY` y ya autenticó a su propio usuario antes de llamar). Cualquiera que tenga `APP_API_KEY` puede mandar cualquier `X-User-Id` y leer/editar/borrar los chats de otro colaborador (IDOR).

Esto es intencional para v1 (API key compartida, sin login propio en esta API), pero implica una regla dura de integración:

- **Nunca** expongas esta API directo al browser del colaborador pasando `X-User-Id` desde un valor que el usuario o el frontend puedan controlar libremente.
- Llama esta API **solo server-to-server**: tu backend web autentica al colaborador (su propio login/sesión) y recién ahí, desde tu servidor, hace la request a `/chats/*` con el `X-User-Id` que tu backend ya verificó.
- Si en el futuro este API se va a exponer directo a un cliente no confiable (browser, app móvil sin backend intermedio), hay que reemplazar este esquema por autenticación real por usuario (API key/JWT individual verificado en el servidor), no por un header de texto plano.

## Notas de integración

- El endpoint de mensajes es **síncrono**: la respuesta HTTP ya trae la respuesta completa del agente (puede tardar varios segundos porque internamente llama a Gemini y a Odoo varias veces). No hay streaming ni webhooks — un `POST` = un turno de chat completo.
- No hay soporte de imágenes/adjuntos en `message` — solo texto.
- El `title` de un chat se autocompleta con los primeros ~60 caracteres del primer mensaje del colaborador si no se pasó uno explícito al crear el chat.
