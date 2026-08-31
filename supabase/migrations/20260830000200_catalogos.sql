-- Catálogos: ubigeo (departamentos y provincias del Perú) y trabajadores del taller.
--
-- Los departamentos y provincias van en la migración, no en el seed: no son datos
-- de prueba, son datos que producción necesita el primer día. El seed solo trae
-- usuarios y pedidos de ejemplo.

create table public.departamentos (
  id     smallint generated always as identity primary key,
  nombre text not null unique
);

comment on table public.departamentos is
  'Los 25 departamentos del Perú, incluyendo la Provincia Constitucional del Callao.';

create table public.provincias (
  id              smallint generated always as identity primary key,
  departamento_id smallint not null references public.departamentos (id),
  nombre          text     not null,

  -- Redundante frente a la PK, pero es la que hace posible la FK compuesta desde
  -- `envios_provincia`: sin ella no se puede exigir que la provincia elegida
  -- pertenezca al departamento elegido.
  unique (id, departamento_id),
  unique (departamento_id, nombre)
);

create index provincias_departamento_idx on public.provincias (departamento_id);

-- Quiénes pueden ser responsables de un pedido en el taller.
--
-- Tabla aparte de `usuarios` a propósito: se asigna un pedido a un operario que no
-- tiene cuenta en la app, y se desactiva a alguien sin borrar su historial.
create table public.trabajadores (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null unique,
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

insert into public.trabajadores (nombre) values
  ('Juan'), ('Issac'), ('Angel'), ('Clever'), ('Jhon');

insert into public.departamentos (nombre) values
  ('Amazonas'), ('Áncash'), ('Apurímac'), ('Arequipa'), ('Ayacucho'), ('Cajamarca'),
  ('Callao'), ('Cusco'), ('Huancavelica'), ('Huánuco'), ('Ica'), ('Junín'),
  ('La Libertad'), ('Lambayeque'), ('Lima'), ('Loreto'), ('Madre de Dios'), ('Moquegua'),
  ('Pasco'), ('Piura'), ('Puno'), ('San Martín'), ('Tacna'), ('Tumbes'), ('Ucayali');

-- Las 196 provincias, colgadas de su departamento por nombre.
insert into public.provincias (departamento_id, nombre)
select d.id, v.provincia
from (values
  ('Amazonas','Chachapoyas'), ('Amazonas','Bagua'), ('Amazonas','Bongará'),
  ('Amazonas','Condorcanqui'), ('Amazonas','Luya'), ('Amazonas','Rodríguez de Mendoza'),
  ('Amazonas','Utcubamba'),

  ('Áncash','Huaraz'), ('Áncash','Aija'), ('Áncash','Antonio Raymondi'),
  ('Áncash','Asunción'), ('Áncash','Bolognesi'), ('Áncash','Carhuaz'),
  ('Áncash','Carlos Fermín Fitzcarrald'), ('Áncash','Casma'), ('Áncash','Corongo'),
  ('Áncash','Huari'), ('Áncash','Huarmey'), ('Áncash','Huaylas'),
  ('Áncash','Mariscal Luzuriaga'), ('Áncash','Ocros'), ('Áncash','Pallasca'),
  ('Áncash','Pomabamba'), ('Áncash','Recuay'), ('Áncash','Santa'), ('Áncash','Sihuas'),
  ('Áncash','Yungay'),

  ('Apurímac','Abancay'), ('Apurímac','Andahuaylas'), ('Apurímac','Antabamba'),
  ('Apurímac','Aymaraes'), ('Apurímac','Cotabambas'), ('Apurímac','Chincheros'),
  ('Apurímac','Grau'),

  ('Arequipa','Arequipa'), ('Arequipa','Camaná'), ('Arequipa','Caravelí'),
  ('Arequipa','Castilla'), ('Arequipa','Caylloma'), ('Arequipa','Condesuyos'),
  ('Arequipa','Islay'), ('Arequipa','La Unión'),

  ('Ayacucho','Huamanga'), ('Ayacucho','Cangallo'), ('Ayacucho','Huanca Sancos'),
  ('Ayacucho','Huanta'), ('Ayacucho','La Mar'), ('Ayacucho','Lucanas'),
  ('Ayacucho','Parinacochas'), ('Ayacucho','Páucar del Sara Sara'), ('Ayacucho','Sucre'),
  ('Ayacucho','Víctor Fajardo'), ('Ayacucho','Vilcas Huamán'),

  ('Cajamarca','Cajamarca'), ('Cajamarca','Cajabamba'), ('Cajamarca','Celendín'),
  ('Cajamarca','Chota'), ('Cajamarca','Contumazá'), ('Cajamarca','Cutervo'),
  ('Cajamarca','Hualgayoc'), ('Cajamarca','Jaén'), ('Cajamarca','San Ignacio'),
  ('Cajamarca','San Marcos'), ('Cajamarca','San Miguel'), ('Cajamarca','San Pablo'),
  ('Cajamarca','Santa Cruz'),

  ('Callao','Callao'),

  ('Cusco','Cusco'), ('Cusco','Acomayo'), ('Cusco','Anta'), ('Cusco','Calca'),
  ('Cusco','Canas'), ('Cusco','Canchis'), ('Cusco','Chumbivilcas'), ('Cusco','Espinar'),
  ('Cusco','La Convención'), ('Cusco','Paruro'), ('Cusco','Paucartambo'),
  ('Cusco','Quispicanchi'), ('Cusco','Urubamba'),

  ('Huancavelica','Huancavelica'), ('Huancavelica','Acobamba'), ('Huancavelica','Angaraes'),
  ('Huancavelica','Castrovirreyna'), ('Huancavelica','Churcampa'), ('Huancavelica','Huaytará'),
  ('Huancavelica','Tayacaja'),

  ('Huánuco','Huánuco'), ('Huánuco','Ambo'), ('Huánuco','Dos de Mayo'),
  ('Huánuco','Huacaybamba'), ('Huánuco','Huamalíes'), ('Huánuco','Leoncio Prado'),
  ('Huánuco','Marañón'), ('Huánuco','Pachitea'), ('Huánuco','Puerto Inca'),
  ('Huánuco','Lauricocha'), ('Huánuco','Yarowilca'),

  ('Ica','Ica'), ('Ica','Chincha'), ('Ica','Nasca'), ('Ica','Palpa'), ('Ica','Pisco'),

  ('Junín','Huancayo'), ('Junín','Concepción'), ('Junín','Chanchamayo'), ('Junín','Jauja'),
  ('Junín','Junín'), ('Junín','Satipo'), ('Junín','Tarma'), ('Junín','Yauli'),
  ('Junín','Chupaca'),

  ('La Libertad','Trujillo'), ('La Libertad','Ascope'), ('La Libertad','Bolívar'),
  ('La Libertad','Chepén'), ('La Libertad','Julcán'), ('La Libertad','Otuzco'),
  ('La Libertad','Pacasmayo'), ('La Libertad','Pataz'), ('La Libertad','Sánchez Carrión'),
  ('La Libertad','Santiago de Chuco'), ('La Libertad','Gran Chimú'), ('La Libertad','Virú'),

  ('Lambayeque','Chiclayo'), ('Lambayeque','Ferreñafe'), ('Lambayeque','Lambayeque'),

  ('Lima','Lima'), ('Lima','Barranca'), ('Lima','Cajatambo'), ('Lima','Canta'),
  ('Lima','Cañete'), ('Lima','Huaral'), ('Lima','Huarochirí'), ('Lima','Huaura'),
  ('Lima','Oyón'), ('Lima','Yauyos'),

  ('Loreto','Maynas'), ('Loreto','Alto Amazonas'), ('Loreto','Loreto'),
  ('Loreto','Mariscal Ramón Castilla'), ('Loreto','Requena'), ('Loreto','Ucayali'),
  ('Loreto','Datem del Marañón'), ('Loreto','Putumayo'),

  ('Madre de Dios','Tambopata'), ('Madre de Dios','Manu'), ('Madre de Dios','Tahuamanu'),

  ('Moquegua','Mariscal Nieto'), ('Moquegua','General Sánchez Cerro'), ('Moquegua','Ilo'),

  ('Pasco','Pasco'), ('Pasco','Daniel Alcides Carrión'), ('Pasco','Oxapampa'),

  ('Piura','Piura'), ('Piura','Ayabaca'), ('Piura','Huancabamba'), ('Piura','Morropón'),
  ('Piura','Paita'), ('Piura','Sullana'), ('Piura','Talara'), ('Piura','Sechura'),

  ('Puno','Puno'), ('Puno','Azángaro'), ('Puno','Carabaya'), ('Puno','Chucuito'),
  ('Puno','El Collao'), ('Puno','Huancané'), ('Puno','Lampa'), ('Puno','Melgar'),
  ('Puno','Moho'), ('Puno','San Antonio de Putina'), ('Puno','San Román'),
  ('Puno','Sandia'), ('Puno','Yunguyo'),

  ('San Martín','Moyobamba'), ('San Martín','Bellavista'), ('San Martín','El Dorado'),
  ('San Martín','Huallaga'), ('San Martín','Lamas'), ('San Martín','Mariscal Cáceres'),
  ('San Martín','Picota'), ('San Martín','Rioja'), ('San Martín','San Martín'),
  ('San Martín','Tocache'),

  ('Tacna','Tacna'), ('Tacna','Candarave'), ('Tacna','Jorge Basadre'), ('Tacna','Tarata'),

  ('Tumbes','Tumbes'), ('Tumbes','Contralmirante Villar'), ('Tumbes','Zarumilla'),

  ('Ucayali','Coronel Portillo'), ('Ucayali','Atalaya'), ('Ucayali','Padre Abad'),
  ('Ucayali','Purús')
) as v (departamento, provincia)
join public.departamentos d on d.nombre = v.departamento;

-- Si el catálogo entra incompleto, el desplegable de destino miente en silencio.
-- Mejor que falle la migración.
do $$
declare n integer;
begin
  select count(*) into n from public.provincias;
  if n <> 196 then
    raise exception 'El catálogo de provincias cargó % filas, se esperaban 196', n;
  end if;
end $$;
