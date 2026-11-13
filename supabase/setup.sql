-- Dropnote: run this setup script in the Supabase SQL editor to create or update the app schema and RPC functions.
-- Room codes work like shared passcodes. Do not use this for sensitive text.
create table if not exists public.dropnote_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{5}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.dropnote_notes (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.dropnote_rooms(code) on delete cascade,
  content text not null check (char_length(content) between 1 and 10000),
  created_at timestamptz not null default now()
);

-- Preserve the existing newest-first order when upgrading an existing database.
alter table public.dropnote_notes add column if not exists position bigint;
with ranked as (
  select id, row_number() over (partition by room_code order by created_at desc, id) as position
  from public.dropnote_notes
)
update public.dropnote_notes n set position = r.position
from ranked r where r.id = n.id and n.position is null;
alter table public.dropnote_notes alter column position set not null;
create index if not exists dropnote_notes_room_position_idx
  on public.dropnote_notes (room_code, position);

create index if not exists dropnote_notes_room_created_idx
  on public.dropnote_notes (room_code, created_at desc);

alter table public.dropnote_rooms enable row level security;
alter table public.dropnote_notes enable row level security;

revoke all on public.dropnote_rooms from anon, authenticated;
revoke all on public.dropnote_notes from anon, authenticated;

create or replace function public.create_room(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_code !~ '^[A-Z0-9]{5}$' then
    raise exception 'Invalid room code';
  end if;
  insert into public.dropnote_rooms (code) values (p_code);
  return true;
end;
$$;

create or replace function public.read_notes(p_code text)
returns table (id uuid, content text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.dropnote_rooms r where r.code = p_code) then
    raise exception 'Room not found';
  end if;
  return query
    select n.id, n.content, n.created_at
    from public.dropnote_notes n
    where n.room_code = p_code
    order by n.position, n.id;
end;
$$;

create or replace function public.read_note(p_code text, p_note_id uuid)
returns table (id uuid, content text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select n.id, n.content, n.created_at
    from public.dropnote_notes n
    where n.room_code = p_code and n.id = p_note_id;
end;
$$;

create or replace function public.post_note(p_code text, p_content text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if char_length(trim(p_content)) not between 1 and 10000 then
    raise exception 'Note must contain between 1 and 10000 characters';
  end if;
  -- Serialize inserts and moves within a room.
  perform 1 from public.dropnote_rooms r where r.code = p_code for update;
  if not found then
    raise exception 'Room not found';
  end if;
  insert into public.dropnote_notes (room_code, content, position)
  values (p_code, trim(p_content),
    (select coalesce(min(n.position), 1) - 1 from public.dropnote_notes n where n.room_code = p_code))
  returning id into new_id;
  return new_id;
end;
$$;

-- The room code authorizes access, matching the existing note RPCs.
-- Lock the room before finding the neighbor to avoid conflicting concurrent moves.
create or replace function public.move_note(p_code text, p_note_id uuid, p_direction integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_position bigint;
  neighbor_id uuid;
  neighbor_position bigint;
begin
  if p_direction is null or p_direction not in (-1, 1) then
    raise exception 'Invalid direction';
  end if;
  perform 1 from public.dropnote_rooms r where r.code = p_code for update;
  if not found then raise exception 'Room not found'; end if;
  select n.position into current_position from public.dropnote_notes n
    where n.room_code = p_code and n.id = p_note_id;
  if not found then raise exception 'Note not found'; end if;
  if p_direction = -1 then
    select n.id, n.position into neighbor_id, neighbor_position
      from public.dropnote_notes n
      where n.room_code = p_code and n.position < current_position
      order by n.position desc limit 1;
  else
    select n.id, n.position into neighbor_id, neighbor_position
      from public.dropnote_notes n
      where n.room_code = p_code and n.position > current_position
      order by n.position limit 1;
  end if;
  if neighbor_id is null then return; end if;
  update public.dropnote_notes n
    set position = case when n.id = p_note_id then neighbor_position else current_position end
    where n.room_code = p_code and n.id in (p_note_id, neighbor_id);
end;
$$;
revoke all on function public.move_note(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.move_note(text, uuid, integer) to anon, authenticated;

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

revoke all on function public.create_room(text) from public, anon, authenticated;
revoke all on function public.read_notes(text) from public, anon, authenticated;
revoke all on function public.read_note(text, uuid) from public, anon, authenticated;
revoke all on function public.post_note(text, text) from public, anon, authenticated;
revoke all on function public.delete_room(text) from public, anon, authenticated;
grant execute on function public.create_room(text) to anon, authenticated;
grant execute on function public.read_notes(text) to anon, authenticated;
grant execute on function public.read_note(text, uuid) to anon, authenticated;
grant execute on function public.post_note(text, text) to anon, authenticated;
grant execute on function public.delete_room(text) to anon, authenticated;

-- Realtime broadcasts use public channels and never carry note content.
