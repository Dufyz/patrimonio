-- Dois níveis: grupo (parent_id nulo) e categoria. O grupo é a soma das
-- categorias dentro dele.
create table category (
  id         uuid primary key,
  parent_id  uuid references category (id) on delete restrict,
  name       text not null,
  color_token text not null,
  auto_rule  jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint category_not_own_parent check (parent_id is null or parent_id <> id)
);

-- Nome único dentro do mesmo nível; o UUID zero representa "sem pai".
create unique index category_name_per_parent_idx
  on category (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create index category_parent_idx on category (parent_id) where parent_id is not null;

-- Dois níveis, não três: o pai de uma categoria precisa ser grupo.
create or replace function assert_category_two_levels() returns trigger
language plpgsql as $$
begin
  if new.parent_id is not null
     and exists (select 1 from category c where c.id = new.parent_id and c.parent_id is not null)
  then
    raise exception 'categoria aceita dois níveis: o pai de %s já tem pai', new.name
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger category_two_levels
  before insert or update on category
  for each row execute function assert_category_two_levels();

create trigger category_set_updated_at
  before update on category
  for each row execute function set_updated_at();
