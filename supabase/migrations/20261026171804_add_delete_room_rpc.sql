create or replace function public.delete_room(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_code text;
begin
  if p_code !~ '^[A-Z0-9]{5}$' then
    raise exception 'Invalid room code';
  end if;

  delete from public.dropnote_rooms
  where code = p_code
  returning code into deleted_code;

  return deleted_code is not null;
end;
$$;

revoke all on function public.delete_room(text) from public, anon, authenticated;
grant execute on function public.delete_room(text) to anon, authenticated;
