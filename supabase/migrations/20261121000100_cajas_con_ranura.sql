-- La plantilla «caja» ya tiene ranura (en la tapa o en el frente). La caja con
-- ranura y la de rifas y sorteos llevan tapa con la ranura centrada, 100 × 10 mm
-- (los valores por defecto de la plantilla): caben en todas sus medidas.

update public.pt_productos
set parametros_cad = parametros_cad || '{"con_tapa": true, "ranura": "tapa"}'::jsonb
where codigo in ('CAJ-005', 'CAJ-006')
  and plantilla_cad = 'caja';
