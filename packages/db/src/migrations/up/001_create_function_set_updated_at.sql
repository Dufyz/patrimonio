-- O updated_at é mantido pelo banco, nunca pela aplicação: assim nenhuma
-- escrita esquece de atualizá-lo. É o único objeto compartilhado a ganhar
-- migration própria.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
