/* Genera supabase/seed.sql a partir de web/lib/datos.ts.
   Transcribir 23 pedidos a mano es una fuente de erratas; esto los lee del mock. */
const fs = require("fs");
const path = require("path");

const raiz = "C:/Users/renat/OneDrive/Desktop/PlexiSistema/web";
const fuente = fs.readFileSync(path.join(raiz, "lib/datos.ts"), "utf8");

const js = fuente
  .replace(/^import type .*$/gm, "")
  .replace(/^type .*$/gm, "")
  .replace(/export const/g, "const")
  .replace(/: Pedido\["[a-zA-Z]+"\]/g, "")
  .replace(/: PedidoSemilla\[\]/g, "")
  .replace(/ as const/g, "")
  .replace(/\(creado: string, estado\)/, "(creado, estado)");

const modulo = { exports: {} };
new Function("module", "exports", js + "\nmodule.exports = { PEDIDOS, HOY, DEPARTAMENTOS };")(
  modulo,
  modulo.exports,
);
const { PEDIDOS, HOY } = modulo.exports;

/* ── helpers ── */
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === null || v === undefined ? "null" : String(v));
const bool = (v) => (v ? "true" : "false");
const arr = (a) => `array[${a.map((x) => `'${x}'`).join(", ")}]::public.tipo_pedido[]`;

/* El correo es interno: se entra con el usuario. Ver la migración
   20260831000100_login_por_usuario.sql. */
const USUARIOS = {
  "Ana Torres": { usuario: "ana", email: "ana@plexiacril.test", rol: "administracion" },
  "Carla Díaz": { usuario: "carla", email: "carla@plexiacril.test", rol: "logistica" },
  "Miguel Ruiz": { usuario: "miguel", email: "miguel@plexiacril.test", rol: "operaciones" },
};
const usuario = (nombre) => {
  const u = USUARIOS[nombre];
  if (!u) throw new Error(`Usuario desconocido en el mock: ${nombre}`);
  return `(select id from public.usuarios where email = ${q(u.email)})`;
};
const trabajador = (n) => (n ? `(select id from public.trabajadores where nombre = ${q(n)})` : "null");
const pedidoId = (codigo) => `(select id from public.pedidos where codigo = ${q(codigo)})`;
const departamento = (n) => `(select id from public.departamentos where nombre = ${q(n)})`;
const provincia = (dep, prov) =>
  prov
    ? `(select pr.id from public.provincias pr join public.departamentos d on d.id = pr.departamento_id
        where d.nombre = ${q(dep)} and pr.nombre = ${q(prov)})`
    : "null";

const bytes = (peso) => {
  const m = /^([\d.]+)\s*(KB|MB)$/i.exec(peso ?? "");
  if (!m) return "null";
  const n = parseFloat(m[1]);
  return String(Math.round(n * (m[2].toUpperCase() === "MB" ? 1024 * 1024 : 1024)));
};
const mime = (nombre) => {
  const ext = nombre.split(".").pop().toLowerCase();
  return { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
           dxf: "image/vnd.dxf", ai: "application/postscript" }[ext] ?? "application/octet-stream";
};

/* ── SQL ── */
const L = [];
L.push(`-- Seed de desarrollo de Plexiacril. GENERADO desde web/lib/datos.ts
-- (scripts/gen-seed.cjs). Si cambian los datos del prototipo, se regenera; no se
-- edita a mano.
--
-- Trae los tres usuarios de prueba, uno por rol, y los ${PEDIDOS.length} pedidos del prototipo,
-- que ya cubren los siete estados, envíos a provincia, crédito, pedidos con varios
-- tipos y pedidos anulados y observados.
--
-- Contraseña de los tres: plexi2026. Es un entorno de desarrollo; antes de que
-- entren datos reales hay que cambiarlas.

-- pgcrypto vive en el esquema extensions en Supabase, que no está en el search_path
-- de la sesión que ejecuta el seed: hay que habilitarlo y llamarlo con nombre completo.
create extension if not exists pgcrypto with schema extensions;

-- La carga no es la edición de nadie: sin esto, la auditoría arranca con cientos
-- de filas de ruido y el historial pierde las fechas reales del prototipo.
alter table public.pedidos          disable trigger pedidos_auditoria;
alter table public.pedidos          disable trigger pedidos_historial;
alter table public.envios_provincia disable trigger envios_provincia_auditoria;
alter table public.adjuntos         disable trigger adjuntos_auditoria;

-- ── Usuarios ────────────────────────────────────────────────────────────────`);

for (const [nombre, u] of Object.entries(USUARIOS)) {
  L.push(`
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  -- GoTrue lee estas columnas como texto, no como texto nullable: con NULL, el
  -- inicio de sesión falla con un error de base de datos que no explica nada.
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  ${q(u.email)}, extensions.crypt('plexi2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('nombre', ${q(nombre)}, 'usuario', ${q(u.usuario)}, 'rol', ${q(u.rol)}),
  now(), now(),
  '', '', '', '', '', '', '', ''
-- El índice único de auth.users sobre email es parcial, así que ON CONFLICT no
-- sirve aquí: hay que preguntar a mano si la cuenta ya existe.
where not exists (select 1 from auth.users where email = ${q(u.email)});`);
}

L.push(`
-- Sin fila en auth.identities, GoTrue no encuentra la cuenta al iniciar sesión
-- con email y contraseña, aunque el usuario exista.
insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
-- Para el proveedor \`email\`, el panel guarda el uuid del usuario como provider_id.
select gen_random_uuid(), u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email),
       'email', u.id::text, now(), now(), now()
from auth.users u
where u.email like '%@plexiacril.test'
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- ── Pedidos ─────────────────────────────────────────────────────────────────`);

const faltaMotivo = [];
for (const p of PEDIDOS) {
  const motivo = p.motivo ?? (["anulado", "observado"].includes(p.estado) ? "Sin motivo registrado" : null);
  if (["anulado", "observado"].includes(p.estado) && !p.motivo) faltaMotivo.push(p.codigo);
  const creador = p.historial?.[0]?.usuario ?? "Ana Torres";

  L.push(`
insert into public.pedidos (
  codigo, es_provincia, nombre_cliente, telefono_cliente, tipos_pedido, tipo_producto_terminado,
  cantidad, tipo_pago, plazo_credito_dias, monto_total, lugar_entrega, direccion_entrega,
  ubicacion_actual, estado, motivo, fecha_prometida, fecha_creacion, fecha_entrega, fecha_anulacion,
  detalle, observaciones, numero_factura, responsable_id, creado_por
) values (
  ${q(p.codigo)}, ${bool(p.esProvincia)}, ${q(p.cliente)}, ${q(p.telefonoCliente)},
  ${arr(p.tipos)}, ${p.producto ? `'${p.producto}'` : "null"},
  ${num(p.cantidad)}, ${q(p.tipoPago)}, ${num(p.plazoCredito)}, ${num(p.montoTotal)},
  ${q(p.entrega)}, ${q(p.direccion ?? null)},
  ${q(p.ubicacion)}, ${q(p.estado)}, ${q(motivo)},
  ${q(p.fechaPrometida)}, ${q(p.fechaCreacion + " 09:00:00-05")}, ${q(p.fechaEntrega ?? null)}, ${q(p.fechaAnulacion ?? null)},
  ${q(p.detalle)}, ${q(p.observaciones)}, ${q(p.numeroFactura)},
  ${trabajador(p.responsable)}, ${usuario(creador)}
);`);

  if (p.envio) {
    const e = p.envio;
    L.push(`
insert into public.envios_provincia (
  pedido_id, departamento_id, provincia_id, nombre_agencia, nombre_persona_recoge,
  tipo_documento, numero_documento, telefono_persona_recoge, monto_flete, flete_pagado,
  observaciones_envio
) values (
  ${pedidoId(p.codigo)}, ${departamento(e.departamento)}, ${provincia(e.departamento, e.provincia)},
  ${q(e.agencia)}, ${q(e.personaQueRecoge)}, ${q(e.tipoDocumento)}, ${q(e.numeroDocumento)},
  ${q(e.telefono)}, ${num(e.montoFlete)}, ${bool(e.fletePagado)}, ${q(e.observacionesEnvio ?? null)}
);`);
  }

  for (const a of p.abonos ?? []) {
    L.push(`
insert into public.pagos (pedido_id, monto, metodo, fecha, registrado_por)
values (${pedidoId(p.codigo)}, ${num(a.monto)}, ${q(a.metodo)}, ${q(a.fecha + " 12:00:00-05")}, ${usuario(a.usuario)});`);
  }

  for (const a of p.adjuntos ?? []) {
    L.push(`
insert into public.adjuntos (pedido_id, tipo, storage_path, nombre_archivo, mime_type, tamano_bytes, subido_por)
values (${pedidoId(p.codigo)}, ${q(a.tipo)}, ${q(`pedidos/${p.codigo}/${a.tipo}/${a.nombre}`)},
        ${q(a.nombre)}, ${q(mime(a.nombre))}, ${bytes(a.peso)}, ${usuario("Ana Torres")});`);
  }

  for (const h of p.historial ?? []) {
    L.push(`
insert into public.historial_estados (pedido_id, estado, rol, motivo, usuario_id, creado_en)
values (${pedidoId(p.codigo)}, ${q(h.estado)}, ${q(h.rol)}, ${q(h.motivo ?? null)}, ${usuario(h.usuario)}, ${q(h.fecha + "-05")});`);
  }

  for (const a of p.auditoria ?? []) {
    L.push(`
insert into public.logs_auditoria (pedido_id, usuario_id, campo, valor_anterior, valor_nuevo, creado_en)
values (${pedidoId(p.codigo)}, ${usuario(a.usuario)}, ${q(a.campo)}, ${q(a.anterior)}, ${q(a.nuevo)}, ${q(a.fecha + "-05")});`);
  }
}

L.push(`
alter table public.pedidos          enable trigger pedidos_auditoria;
alter table public.pedidos          enable trigger pedidos_historial;
alter table public.envios_provincia enable trigger envios_provincia_auditoria;
alter table public.adjuntos         enable trigger adjuntos_auditoria;

-- El trigger de \`pagos\` ya dejó \`monto_pagado\` al día; esto solo confirma que la
-- suma de abonos coincide con lo que traía el prototipo.
do $$
declare descuadre integer;
begin
  select count(*) into descuadre
  from public.pedidos p
  where p.monto_pagado <> coalesce((select sum(g.monto) from public.pagos g where g.pedido_id = p.id), 0);

  if descuadre > 0 then
    raise exception 'El seed dejó % pedidos con el monto pagado descuadrado', descuadre;
  end if;
end $$;`);

fs.writeFileSync(path.join(raiz, "supabase/seed.sql"), L.join("\n") + "\n", "utf8");
console.log(`pedidos: ${PEDIDOS.length}, HOY: ${HOY}`);
if (faltaMotivo.length) console.log(`sin motivo en el mock: ${faltaMotivo.join(", ")}`);
