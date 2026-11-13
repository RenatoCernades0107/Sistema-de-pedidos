-- Caras del modelo 3D señaladas con un mensaje del chat de diseños.
--
-- En el visor de `/disenos` la persona puede señalar caras y cantos de las
-- piezas para referirlos en su mensaje ("haz un agujero en esta cara"). Se
-- guardan con el mensaje para volver a pintarlas como fichas al abrir el
-- diseño y para reenviárselas al asistente en el historial. Es la descripción
-- que ve el asistente (pieza, qué cara, medidas, centro y normal en mm), no la
-- geometría: la forma la valida la app (`lib/cad/caras.ts`).

alter table public.cad_mensajes
  add column referencias jsonb
    check (referencias is null or jsonb_typeof(referencias) = 'array');

comment on column public.cad_mensajes.referencias is
  'Caras del visor 3D señaladas con el mensaje (lista de ReferenciaCara, lib/cad/caras.ts). Null si ninguna.';
