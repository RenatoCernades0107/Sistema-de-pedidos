-- La ficha de un producto terminado ahora trae sus cortes (`lib/terminados/guardado.ts`,
-- campo `corte`): las piezas y cómo se acomodan en la plancha. Ahí también hay
-- dinero —el precio del formato y lo que vale cada plancha o fracción—, así que
-- quien no es Administración lo recibe en cero, como en `corte_sin_precios`.
--
-- Las fichas de antes no tienen `corte`, o lo tienen en null: quedan igual.

create or replace function public.terminado_sin_precios(t jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select t
    || '{"precioSugerido": 0, "precioUnitario": 0, "costoMaterial": 0, "factor": 1}'::jsonb
    || jsonb_build_object(
      'opciones',
      coalesce(
        (select jsonb_agg(o || '{"extra": 0}'::jsonb order by n)
           from jsonb_array_elements(t -> 'opciones') with ordinality as x (o, n)),
        '[]'::jsonb
      ),
      'materiales',
      coalesce(
        (select jsonb_agg(m || '{"precio": 0}'::jsonb order by n)
           from jsonb_array_elements(t -> 'materiales') with ordinality as x (m, n)),
        '[]'::jsonb
      )
    )
    || case
      when jsonb_typeof(t -> 'corte') = 'object' then jsonb_build_object(
        'corte',
        jsonb_set(
          jsonb_set(t -> 'corte', '{formato,precio}', '0'::jsonb),
          '{planchas}',
          coalesce(
            (select jsonb_agg(jsonb_set(p, '{cobro,monto}', '0'::jsonb) order by n)
               from jsonb_array_elements(t -> 'corte' -> 'planchas') with ordinality as x (p, n)),
            '[]'::jsonb
          )
        )
      )
      else '{}'::jsonb
    end
$$;
