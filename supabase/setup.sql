-- Dropnote: run once in the Supabase SQL editor.
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
    order by n.created_at desc;
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
  if not exists (select 1 from public.dropnote_rooms r where r.code = p_code) then
    raise exception 'Room not found';
  end if;
  insert into public.dropnote_notes (room_code, content)
  values (p_code, trim(p_content))
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.create_room(text) from public, anon, authenticated;
revoke all on function public.read_notes(text) from public, anon, authenticated;
revoke all on function public.post_note(text, text) from public, anon, authenticated;
grant execute on function public.create_room(text) to anon, authenticated;
grant execute on function public.read_notes(text) to anon, authenticated;
grant execute on function public.post_note(text, text) to anon, authenticated;

-- Realtime broadcasts use public channels and never carry note content.
