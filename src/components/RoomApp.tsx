import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { Check, ChevronLeft, Clipboard, Copy, Link2, LoaderCircle, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Kbd } from './ui/kbd';
import { Textarea } from './ui/textarea';

type Note = { id: string; content: string; created_at: string };
type Props = { supabaseUrl?: string; supabaseKey?: string };
const localStorageKey = 'dropnote-rooms-v1';

function readLocal(): Record<string, Note[]> {
	try { return JSON.parse(localStorage.getItem(localStorageKey) ?? '{}'); } catch { return {}; }
}

export default function RoomApp({ supabaseUrl = '', supabaseKey = '' }: Props) {
	const client = useMemo<SupabaseClient | null>(() => supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null, [supabaseUrl, supabaseKey]);
	const [room, setRoom] = useState('');
	const [notes, setNotes] = useState<Note[]>([]);
	const [draft, setDraft] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [copied, setCopied] = useState('');
	const [connected, setConnected] = useState(false);
	const [showDelete, setShowDelete] = useState(false);
	const [deleteCode, setDeleteCode] = useState('');
	const channelRef = useRef<RealtimeChannel | null>(null);
	const textAreaRef = useRef<HTMLTextAreaElement>(null);

	const loadNotes = useCallback(async (code: string) => {
		if (!code) return;
		if (!client) { setNotes(readLocal()[code] ?? []); return; }
		const { data, error: fetchError } = await client.rpc('read_notes', { p_code: code });
		if (fetchError) setError('Could not refresh notes. Check the room and try again.');
		else setNotes((data ?? []) as Note[]);
	}, [client]);

	const openRoom = async (value: string) => {
		const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
		if (code.length !== 5) { setError('This room link is missing a valid five-character code.'); return; }
		setBusy(true); setError('');
		if (client) {
			const { data, error: openError } = await client.rpc('read_notes', { p_code: code });
			if (openError) { setError('Could not open room. Check the room link and try again.'); setBusy(false); return; }
			setNotes((data ?? []) as Note[]);
		} else {
			const local = readLocal();
			if (!local[code]) { setError('That room is empty here. Without Supabase, rooms stay in this browser.'); setBusy(false); return; }
			setNotes(local[code]);
		}
		setRoom(code); setBusy(false);
	};

	useEffect(() => {
		const code = new URLSearchParams(window.location.search).get('code') ?? '';
		void openRoom(code);
		// Initial route restore only.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		document.documentElement.dataset.connectionConnected = String(connected);
		window.dispatchEvent(new CustomEvent('dropnote:connection', { detail: { connected } }));
	}, [connected]);

	useEffect(() => {
		const textarea = textAreaRef.current;
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${textarea.scrollHeight}px`;
	}, [draft]);

	useEffect(() => {
		if (!room || !client) { setConnected(false); return; }
		const channel = client.channel(`room:${room}`, { config: { broadcast: { self: false } } });
		channel.on('broadcast', { event: 'note-added' }, () => void loadNotes(room));
		channel.subscribe((status) => setConnected(status === 'SUBSCRIBED'));
		channelRef.current = channel;
		return () => { channelRef.current = null; void client.removeChannel(channel); };
	}, [client, room, loadNotes]);

	const postNote = async (event: FormEvent) => {
		event.preventDefault();
		const content = draft.trim();
		if (!room || !content || busy) return;
		setBusy(true); setError('');
		if (client) {
			const { error: postError } = await client.rpc('post_note', { p_code: room, p_content: content });
			if (postError) { setError('Could not save note. Check the Supabase setup and try again.'); setBusy(false); return; }
			setDraft(''); await loadNotes(room);
			await channelRef.current?.send({ type: 'broadcast', event: 'note-added', payload: {} });
		} else {
			const local = readLocal();
			const next = [{ id: crypto.randomUUID(), content, created_at: new Date().toISOString() }, ...(local[room] ?? [])];
			local[room] = next; localStorage.setItem(localStorageKey, JSON.stringify(local)); setNotes(next); setDraft('');
		}
		setBusy(false);
	};

	const deleteRoom = async () => {
		if (!room || deleteCode !== room || busy) return;
		setBusy(true); setError('');
		if (client) {
			const { data, error: deleteError } = await client.rpc('delete_room', { p_code: room });
			if (deleteError) {
				const missingFunction = deleteError.code === 'PGRST202' || /function .*delete_room.*(not found|schema cache)/i.test(deleteError.message);
				setError(missingFunction
					? 'Room deletion is not enabled in Supabase yet. Run the updated supabase/setup.sql in the Supabase SQL Editor, then retry.'
					: `Could not delete room: ${deleteError.message}`);
				setBusy(false);
				return;
			}
			if (!data) { setError('This room no longer exists. Return to the home page.'); setBusy(false); return; }
		} else {
			const local = readLocal(); delete local[room]; localStorage.setItem(localStorageKey, JSON.stringify(local));
		}
		window.location.assign('/');
	};

	const copyText = async (text: string, id: string) => {
		try { await navigator.clipboard.writeText(text); setCopied(id); window.setTimeout(() => setCopied(''), 1500); }
		catch { setError('Clipboard access is unavailable. Select and copy the text instead.'); }
	};

	const formatTime = (date: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(date));

	if (!room) return <main className="px-4 pb-5 sm:px-8 sm:pb-8"><div className="mx-auto max-w-4xl py-16 text-sm text-[#81788f]" role={error ? 'alert' : 'status'}>{error || (busy ? 'Opening room…' : 'Opening room…')}</div></main>;

	return <main className="px-4 pb-5 sm:px-8 sm:pb-8">
		<section className="mx-auto w-full max-w-4xl pb-12 pt-10 sm:pt-16">
			<div className="mb-8 flex flex-col gap-5 border-b border-[#e3dcec] pb-6 sm:flex-row sm:items-end sm:justify-between">
				<div><a href="/" className="mb-3 inline-flex items-center gap-1 text-xs text-[#81788f] hover:text-[#6d4ca3]"><ChevronLeft size={15}/> All rooms</a><div className="flex items-center gap-3"><h1 className="text-4xl font-semibold tracking-[-0.06em] text-[#2b2439]">Room <span className="font-mono text-[#765b9b]">{room}</span></h1><button aria-label="Copy room link" onClick={() => void copyText(window.location.href, 'room')} className="grid size-9 place-items-center rounded-lg text-[#786f88] hover:bg-white">{copied === 'room' ? <Check size={17}/> : <Link2 size={17}/>}</button></div><p className="mt-2 text-sm text-[#81788f]">Anything you drop here is ready to copy anywhere.</p></div>
				<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void copyText(room, 'code')} className="w-fit">{copied === 'code' ? <Check size={16}/> : <Copy size={16}/>} {copied === 'code' ? 'Copied' : 'Copy room code'}</Button><Button variant="destructive" onClick={() => { setDeleteCode(''); setShowDelete(true); }} className="w-fit"><Trash2 size={16}/> Delete room</Button></div>
			</div>
			<form onSubmit={postNote} className="overflow-hidden rounded-2xl border border-[#e3dcec] bg-white shadow-[0_14px_45px_-35px_rgba(33,54,44,.4)]">
				<Textarea ref={textAreaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void postNote(event); }} placeholder="Paste or type something to share…" aria-label="Note to share" maxLength={10000} rows={4} className="min-h-[160px] resize-none overflow-hidden border-0 px-5 py-5 text-[15px] leading-7 shadow-none placeholder:text-[#a198ae] focus-visible:border-0 focus-visible:ring-0" />
				<div className="flex items-center justify-between border-t border-[#f1edf7] px-4 py-3"><span className="flex items-center gap-1.5 text-xs text-[#a198ae]"><span>{draft.length}/10,000 ·</span><Kbd>⌘ / Ctrl</Kbd><span>+</span><Kbd>Enter</Kbd><span>to send</span></span><Button type="submit" disabled={!draft.trim() || busy} className="rounded-lg">{busy ? <LoaderCircle className="animate-spin" size={16}/> : <Send size={16}/>} Add to room</Button></div>
			</form>
			{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
			<div className="mb-3 mt-9 flex items-center justify-between"><h2 className="text-sm font-semibold text-[#4a415a]">Shared notes <span className="ml-1 font-normal text-[#a098ad]">{notes.length}</span></h2><Button variant="ghost" size="sm" aria-label="Refresh shared notes" onClick={() => void loadNotes(room)} className="h-8 gap-1.5 px-2 text-xs"><RefreshCw size={14}/> Refresh</Button></div>
			{notes.length === 0 ? <div className="rounded-2xl border border-dashed border-[#ddd5e9] px-6 py-14 text-center"><div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-[#efeaf7] text-[#725498]"><Clipboard size={19}/></div><h3 className="text-sm font-medium text-[#4a415a]">Nothing in the room yet</h3><p className="mt-1 text-sm text-[#928aa0]">Drop in a note, link, or snippet to get started.</p></div> : <div className="relative space-y-3 pl-7 before:absolute before:bottom-0 before:left-3 before:top-0 before:w-px before:bg-[#ddd5e9]">{notes.map((note, index) => <article key={note.id} className="group relative rounded-2xl border border-[#e5def0] bg-white px-5 py-4 transition-colors before:absolute before:-left-5 before:top-6 before:size-2 before:rounded-full before:bg-[#7958ad] before:ring-4 before:ring-[#f7f4fb] hover:border-[#d4c8e8]"><div className="mb-3 flex items-center justify-between"><span className="text-xs text-[#898197]">{formatTime(note.created_at)} <span className="mx-1 text-[#d2c9de]">/</span> Note {notes.length - index}</span><Button variant="ghost" size="sm" onClick={() => void copyText(note.content, note.id)} className="h-8 rounded-lg px-2 text-xs">{copied === note.id ? <Check size={14}/> : <Copy size={14}/>} {copied === note.id ? 'Copied' : 'Copy'}</Button></div><pre className="overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[#423a50]">{note.content}</pre></article>)}</div>}
		</section>
		{showDelete && <div className="fixed inset-0 z-30 grid place-items-center bg-[#251d34]/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowDelete(false); }}><div role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" className="w-full max-w-sm rounded-2xl border border-[#e5def0] bg-[#fbf9fe] p-6 shadow-2xl"><div className="mb-4 flex items-start justify-between"><div><h2 id="delete-title" className="text-lg font-semibold tracking-tight text-[#30283f]">Permanently delete room?</h2><p id="delete-description" className="mt-2 text-sm leading-6 text-[#81788f]">This permanently deletes room <span className="font-mono font-semibold text-[#30283f]">{room}</span> and every note in it for everyone. This cannot be undone.</p></div><button aria-label="Close dialog" disabled={busy} onClick={() => setShowDelete(false)} className="grid size-8 shrink-0 place-items-center rounded-lg text-[#7f758e] hover:bg-[#f1edf7]"><X size={17}/></button></div><label htmlFor="delete-room-code" className="mb-2 block text-sm font-medium text-[#4a415a]">Type {room} to confirm</label><input id="delete-room-code" autoCapitalize="characters" value={deleteCode} onChange={(event) => setDeleteCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))} maxLength={5} className="h-12 w-full rounded-lg border border-[#ded5ea] bg-white px-4 font-mono text-lg tracking-[0.2em] outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setShowDelete(false)}>Cancel</Button><Button type="button" variant="destructive" disabled={busy || deleteCode !== room} onClick={() => void deleteRoom()}>{busy ? <LoaderCircle className="animate-spin" size={16}/> : <Trash2 size={16}/>} Delete permanently</Button></div></div></div>}
	</main>;
}
