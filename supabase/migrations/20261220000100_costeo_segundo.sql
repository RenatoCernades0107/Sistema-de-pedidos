-- Costos y precios, segunda vuelta: dos costeos y un factor.
--
--   1er costeo: la liquidación de la compra (ya está: `costos_historial`).
--   2do costeo: el 1ro más lo que cuesta operar (administrativos, financieros,
--               almacén propio, ventas y despacho). Esos gastos se anotan por mes
--               y se reparten sobre el costo de lo vendido en el mes.
--   Precio:     2do costo × factor (el margen de ganancia), más IGV.
--
-- Esta migración:
--   1. Cambia el margen % por un factor: la configuración y la excepción por
--      plancha (`margenes_plancha` → `factores_plancha`).
--   2. Los gastos de operar de cada mes, por concepto.
--   3. La base de cada mes: el costo de lo vendido (de Odoo, o escrito a mano).
--   4. El historial de precios guarda también el 2do costo y el factor.
-- Todo es de Administración.

-- ── 1. Del margen al factor ─────────────────────────────────────────────────
-- Un margen m sobre el precio es el factor 1 / (1 − m): 30% → 1.429.

create table public.factores_plancha (
  codigo_odoo text primary key check (btrim(codigo_odoo) <> ''),
  factor numeric(6, 3) not null check (factor >= 1 and factor <= 10),
  actualizado_por uuid references public.usuarios (id) default auth.uid(),
  actualizado_en timestamptz not null default now()
);

insert into public.factores_plancha (codigo_odoo, factor, actualizado_por, actualizado_en)
select codigo_odoo, round(1 / (1 - margen_pct / 100), 3), actualizado_por, actualizado_en
from public.margenes_plancha;

drop table public.margenes_plancha;

alter table public.factores_plancha enable row level security;
create policy factores_plancha_admin on public.factores_plancha
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
revoke all on public.factores_plancha from anon, authenticated;
grant select, insert, update, delete on public.factores_plancha to authenticated;

update public.configuracion
set valor = (valor - 'margenDefecto' - 'margenPorMaterial')
  || jsonb_build_object(
       'factorDefecto', coalesce(round(1 / (1 - (valor ->> 'margenDefecto')::numeric / 100), 3), 1.4),
       'factorPorMaterial', coalesce(
         (select jsonb_object_agg(k, round(1 / (1 - v::numeric / 100), 3))
          from jsonb_each_text(coalesce(valor -> 'margenPorMaterial', '{}'::jsonb)) as e(k, v)),
         '{}'::jsonb),
       'mesesPromedio', 3)
where clave = 'costos_precios';

-- ── 2. Gastos de operar, por mes ────────────────────────────────────────────

create table public.gastos_operativos (
  id uuid primary key default gen_random_uuid(),
  -- El primer día del mes al que corresponde.
  mes date not null check (extract(day from mes) = 1),
  concepto text not null check (concepto in ('administrativos', 'financieros', 'almacen', 'ventas_despacho', 'otro')),
  descripcion text,
  monto numeric(14, 2) not null check (monto >= 0),
  creado_por uuid references public.usuarios (id) default auth.uid(),
  creado_en timestamptz not null default now()
);

create index gastos_operativos_mes_idx on public.gastos_operativos (mes);

-- ── 3. La base de cada mes ──────────────────────────────────────────────────
-- El costo de lo vendido: lo que calcula la app con Odoo (lo que salió a
-- clientes × su costo) y, si Administración lo corrige, lo escrito a mano.

create table public.bases_mes (
  mes date primary key check (extract(day from mes) = 1),
  costo_ventas_odoo numeric(14, 2) check (costo_ventas_odoo is null or costo_ventas_odoo >= 0),
  calculado_en timestamptz,
  costo_ventas_manual numeric(14, 2) check (costo_ventas_manual is null or costo_ventas_manual >= 0),
  nota text,
  actualizado_en timestamptz not null default now()
);

alter table public.gastos_operativos enable row level security;
alter table public.bases_mes enable row level security;
create policy gastos_operativos_admin on public.gastos_operativos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy bases_mes_admin on public.bases_mes
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
revoke all on public.gastos_operativos, public.bases_mes from anon, authenticated;
grant select, insert, update, delete on public.gastos_operativos, public.bases_mes to authenticated;

-- ── 4. Historial de precios con los dos costos ──────────────────────────────
-- `costo_base` sigue siendo el 1er costo.

alter table public.cambios_precio
  add column segundo_costo numeric(14, 4),
  add column factor numeric(6, 3);
