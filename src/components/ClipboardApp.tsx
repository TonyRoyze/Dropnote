import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { ArrowDownLeft, Check, Clipboard, Copy, Link2, LoaderCircle, Plus, Send, Trash2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Kbd } from './ui/kbd';

type Note = { id: string; content: string; created_at: string };
type Props = { supabaseUrl?: string; supabaseKey?: string };
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
const localStorageKey = 'dropnote-rooms-v1';

function readLocal(): Record<string, Note[]> {
	try { return JSON.parse(localStorage.getItem(localStorageKey) ?? '{}'); } catch { return {}; }
}

export default function ClipboardApp({ supabaseUrl = '', supabaseKey = '' }: Props) {
	const client = useMemo<SupabaseClient | null>(() => supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null, [supabaseUrl, supabaseKey]);
	const [room, setRoom] = useState('');
	const [inputCode, setInputCode] = useState('');
	const [notes, setNotes] = useState<Note[]>([]);
	const [draft, setDraft] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [copied, setCopied] = useState('');
	const [connected, setConnected] = useState(false);
	const [showJoin, setShowJoin] = useState(false);
	const [showDelete, setShowDelete] = useState(false);
	const [deleteCode, setDeleteCode] = useState('');
	const channelRef = useRef<RealtimeChannel | null>(null);
	const textAreaRef = useRef<HTMLTextAreaElement>(null);
	const shared = Boolean(client);

	const setAddress = (code: string) => {
		setRoom(code);
		if (code) history.replaceState({}, '', `/?room=${code}`);
		else history.replaceState({}, '', '/');
	};

	const loadNotes = useCallback(async (code: string) => {
		if (!code) return;
		if (!client) {
			const local = readLocal();
			setNotes(local[code] ?? []);
			return;
		}
		const { data, error: fetchError } = await client.rpc('read_notes', { p_code: code });
		if (fetchError) setError(fetchError.message);
		else setNotes((data ?? []) as Note[]);
	}, [client]);

	const openRoom = async (code: string) => {
		setBusy(true); setError('');
		const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
		if (normalized.length !== 5) { setError('Enter a five-character room code.'); setBusy(false); return; }
		if (client) {
			const { data, error: openError } = await client.rpc('read_notes', { p_code: normalized });
			if (openError) { setError('Could not open room. Check the Supabase setup and try again.'); setBusy(false); return; }
			setNotes((data ?? []) as Note[]);
		} else {
			const local = readLocal();
			if (!local[normalized]) { setError('That room is empty here. Without Supabase, rooms stay in this browser.'); setBusy(false); return; }
			setNotes(local[normalized]);
		}
		setAddress(normalized); setShowJoin(false); setInputCode(''); setBusy(false);
	};

	const createRoom = async () => {
		setBusy(true); setError('');
		let code = makeCode();
		if (client) {
			let created = false;
			for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
				const { data, error: createError } = await client.rpc('create_room', { p_code: code });
				if (!createError && data) created = true;
				else if (createError && !createError.message.toLowerCase().includes('duplicate')) { setError('Could not create room. Check your Supabase setup.'); setBusy(false); return; }
				else code = makeCode();
			}
			if (!created) { setError('Could not find an unused room code. Try again.'); setBusy(false); return; }
		} else {
			const local = readLocal(); local[code] = []; localStorage.setItem(localStorageKey, JSON.stringify(local));
		}
		setNotes([]); setAddress(code); setBusy(false);
	};

	useEffect(() => {
		const onShortcut = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) return;
			if (event.key.toLowerCase() === 'j') {
				event.preventDefault();
				if (!busy) { setError(''); setShowJoin(true); }
			} else if (event.key.toLowerCase() === 'm') {
				event.preventDefault();
				if (!busy) void createRoom();
			}
		};
		window.addEventListener('keydown', onShortcut);
		return () => window.removeEventListener('keydown', onShortcut);
	}, [busy]);

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
			const local = readLocal(); const next = [{ id: crypto.randomUUID(), content, created_at: new Date().toISOString() }, ...(local[room] ?? [])];
			local[room] = next; localStorage.setItem(localStorageKey, JSON.stringify(local)); setNotes(next); setDraft('');
		}
		setBusy(false);
	};

	const deleteRoom = async () => {
		if (!room || deleteCode !== room || busy) return;
		setBusy(true); setError('');
		if (client) {
			const { data, error: deleteError } = await client.rpc('delete_room', { p_code: room });
			if (deleteError || !data) {
				setError('Could not delete room. Check the Supabase setup and try again.');
				setBusy(false);
				return;
			}
		} else {
			const local = readLocal();
			delete local[room];
			localStorage.setItem(localStorageKey, JSON.stringify(local));
		}
		setShowDelete(false); setDeleteCode(''); setNotes([]); setAddress(''); setBusy(false);
	};

	useEffect(() => {
		const code = new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';
		if (/^[A-Z0-9]{5}$/.test(code)) { setInputCode(code); void openRoom(code); }
		// Initial URL restore only.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (!room || !client) { setConnected(false); return; }
		const channel = client.channel(`room:${room}`, { config: { broadcast: { self: false } } });
		channel.on('broadcast', { event: 'note-added' }, () => void loadNotes(room));
		channel.subscribe((status) => setConnected(status === 'SUBSCRIBED'));
		channelRef.current = channel;
		return () => { channelRef.current = null; void client.removeChannel(channel); };
	}, [client, room, loadNotes]);

	const copyText = async (text: string, id: string) => {
		try { await navigator.clipboard.writeText(text); setCopied(id); window.setTimeout(() => setCopied(''), 1500); }
		catch { setError('Clipboard access is unavailable. Select and copy the text instead.'); }
	};

	const formatTime = (date: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(date));

	return <main className="min-h-screen px-4 py-5 sm:px-8 sm:py-8">
		<header className="mx-auto flex w-full max-w-6xl items-center justify-between">
			<a className="flex items-center gap-2.5 text-[#202b27]" href="/" onClick={(e) => { e.preventDefault(); setAddress(''); setNotes([]); }}>
				<span className="grid size-9 place-items-center rounded-xl bg-[#235c4d] text-white"><Clipboard size={18} strokeWidth={1.8} /></span>
				<span className="font-semibold tracking-[-0.03em]">dropnote</span>
			</a>
			<div className="flex items-center gap-2 text-xs text-[#738079]">
				<span className={`size-2 rounded-full ${shared ? connected ? 'bg-[#2f896c]' : 'bg-[#cf9c49]' : 'bg-[#98a19a]'}`} />
				<span>{shared ? connected ? 'Synced' : 'Connecting' : 'This browser'}</span>
			</div>
		</header>

		{!room ? <section className="mx-auto grid min-h-[calc(100vh-100px)] w-full max-w-6xl items-center gap-12 py-12 lg:grid-cols-[1fr_0.78fr]">
			<div className="max-w-xl">
				<h1 className="text-[clamp(3.4rem,8vw,6.8rem)] font-semibold leading-[0.91] tracking-[-0.075em] text-[#202b27]">Copy here.<br /><span className="text-[#6f7c73]">Paste there.</span></h1>
				<p className="mt-7 max-w-md text-base leading-7 text-[#66726c]">A tiny shared clipboard for the notes, links, and snippets that need to get from one screen to another.</p>
				<div className="mt-9 flex flex-col gap-3 sm:flex-row">
					<Button onClick={() => void createRoom()} disabled={busy} className="h-12 rounded-lg px-5">{busy ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />} Make a room <Kbd>⌘/Ctrl</Kbd><Kbd>M</Kbd></Button>
					<Button variant="outline" onClick={() => setShowJoin(true)} className="h-12 rounded-lg px-5"><ArrowDownLeft size={17} /> Join a room <Kbd>⌘/Ctrl</Kbd><Kbd>J</Kbd></Button>
				</div>
				{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
			</div>
			<div className="relative mx-auto w-full max-w-[420px]">
				<div className="absolute -inset-5 rotate-[-5deg] rounded-[28px] bg-[#e8ece5]" />
				<div className="relative rotate-[2deg] overflow-hidden rounded-[20px] border border-[#e4e7e1] bg-white shadow-[0_24px_80px_-45px_rgba(33,54,44,.28)]">
					<div className="flex items-center justify-between border-b border-[#edf0eb] px-5 py-4"><span className="text-xs font-medium text-[#79857e]">A sample room</span><span className="flex gap-1"><i className="size-1.5 rounded-full bg-[#d4d8d2]"/><i className="size-1.5 rounded-full bg-[#d4d8d2]"/><i className="size-1.5 rounded-full bg-[#d4d8d2]"/></span></div>
					<div className="space-y-3 p-4">
						<div className="rounded-xl border border-[#e9ece6] bg-[#fcfcfa] p-4"><div className="mb-3 flex items-center justify-between text-[11px] text-[#89928c]"><span>Snippet</span><Copy size={13}/></div><p className="font-mono text-[13px] leading-6 text-[#38443e]">https://docs.example.com/<br/>getting-started</p></div>
						<div className="rounded-xl border border-[#e9ece6] bg-[#fcfcfa] p-4"><div className="mb-2 text-[11px] text-[#89928c]">Note · just now</div><p className="text-sm leading-6 text-[#38443e]">Send this to the other laptop<br/>when you get a chance.</p></div>
						<div className="flex items-center gap-2 rounded-xl bg-[#f3f5f1] p-2"><span className="h-9 flex-1 rounded-lg bg-white"/><span className="grid size-9 place-items-center rounded-lg bg-[#235c4d] text-white"><Send size={15}/></span></div>
					</div>
				</div>
				<div className="absolute -right-3 -top-5 grid size-12 rotate-6 place-items-center rounded-2xl border border-[#e0e5dd] bg-white text-[#40826c] shadow-sm"><Link2 size={20}/></div>
			</div>
		</section> : <section className="mx-auto w-full max-w-4xl pb-12 pt-10 sm:pt-16">
			<div className="mb-8 flex flex-col gap-5 border-b border-[#dfe3dc] pb-6 sm:flex-row sm:items-end sm:justify-between">
				<div><button onClick={() => { setAddress(''); setNotes([]); }} className="mb-3 text-xs text-[#78837c] hover:text-[#235c4d]">← All rooms</button><div className="flex items-center gap-3"><h1 className="text-4xl font-semibold tracking-[-0.06em] text-[#202b27]">Room <span className="font-mono text-[#557568]">{room}</span></h1><button aria-label="Copy room link" onClick={() => void copyText(window.location.href, 'room')} className="grid size-9 place-items-center rounded-lg text-[#738079] hover:bg-white">{copied === 'room' ? <Check size={17}/> : <Link2 size={17}/>}</button></div><p className="mt-2 text-sm text-[#7a857e]">Anything you drop here is ready to copy anywhere.</p></div>
				<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void copyText(room, 'code')} className="w-fit">{copied === 'code' ? <Check size={16}/> : <Copy size={16}/>} {copied === 'code' ? 'Copied' : 'Copy room code'}</Button><Button variant="outline" onClick={() => { setDeleteCode(''); setShowDelete(true); }} className="w-fit border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"><Trash2 size={16}/> Delete room</Button></div>
			</div>
			<form onSubmit={postNote} className="overflow-hidden rounded-2xl border border-[#dfe4dd] bg-white shadow-[0_14px_45px_-35px_rgba(33,54,44,.4)]">
				<textarea ref={textAreaRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void postNote(e); }} placeholder="Paste or type something to share…" aria-label="Note to share" maxLength={10000} rows={4} className="w-full resize-y bg-transparent px-5 py-5 text-[15px] leading-7 text-[#25312d] outline-none placeholder:text-[#a0a9a2]" />
				<div className="flex items-center justify-between border-t border-[#edf0eb] px-4 py-3"><span className="flex items-center gap-1.5 text-xs text-[#a0a9a2]"><span>{draft.length}/10,000 ·</span><Kbd>⌘ / Ctrl</Kbd><span>+</span><Kbd>Enter</Kbd><span>to send</span></span><Button type="submit" disabled={!draft.trim() || busy} className="rounded-lg">{busy ? <LoaderCircle className="animate-spin" size={16}/> : <Send size={16}/>} Add to room</Button></div>
			</form>
			{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
			<div className="mb-3 mt-9 flex items-center justify-between"><h2 className="text-sm font-semibold text-[#45524b]">Shared notes <span className="ml-1 font-normal text-[#97a099]">{notes.length}</span></h2><button onClick={() => void loadNotes(room)} className="text-xs text-[#7d8881] hover:text-[#235c4d]">Refresh</button></div>
			{notes.length === 0 ? <div className="rounded-2xl border border-dashed border-[#d7ddd5] px-6 py-14 text-center"><div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-[#e9eee8] text-[#58806f]"><Clipboard size={19}/></div><h3 className="text-sm font-medium text-[#45524b]">Nothing in the room yet</h3><p className="mt-1 text-sm text-[#89938d]">Drop in a note, link, or snippet to get started.</p></div> : <div className="space-y-3">{notes.map((note, index) => <article key={note.id} className="group rounded-2xl border border-[#e1e5df] bg-white px-5 py-4 transition-colors hover:border-[#cdd7ce]"><div className="mb-3 flex items-center justify-between"><span className="text-xs text-[#87928a]">{formatTime(note.created_at)} <span className="mx-1 text-[#c5cbc4]">/</span> Note {notes.length - index}</span><Button variant="ghost" size="sm" onClick={() => void copyText(note.content, note.id)} className="h-8 rounded-lg px-2 text-xs">{copied === note.id ? <Check size={14}/> : <Copy size={14}/>} {copied === note.id ? 'Copied' : 'Copy'}</Button></div><pre className="overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[#35413b]">{note.content}</pre></article>)}</div>}
		</section>}
		{showJoin && <div className="fixed inset-0 z-20 grid place-items-center bg-[#1d2823]/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowJoin(false); }}><div role="dialog" aria-modal="true" aria-labelledby="join-title" className="w-full max-w-sm rounded-2xl border border-[#e1e5df] bg-[#fbfcfa] p-6 shadow-2xl"><div className="mb-4 flex items-start justify-between"><div><h2 id="join-title" className="text-lg font-semibold tracking-tight text-[#25312d]">Join a room</h2><p className="mt-1 text-sm text-[#79857e]">Enter the five-character code someone shared.</p></div><button aria-label="Close dialog" onClick={() => setShowJoin(false)} className="grid size-8 place-items-center rounded-lg text-[#77827b] hover:bg-[#edf0eb]"><X size={17}/></button></div><form onSubmit={(e) => { e.preventDefault(); void openRoom(inputCode); }}><input autoFocus autoCapitalize="characters" value={inputCode} onChange={(e) => setInputCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))} placeholder="e.g. K7P4M" maxLength={5} aria-label="Room code" className="h-12 w-full rounded-lg border border-[#d9ded7] bg-white px-4 font-mono text-lg tracking-[0.2em] outline-none focus:border-[#40826c] focus:ring-2 focus:ring-[#dcebe2]" />{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}<Button type="submit" disabled={busy || inputCode.length !== 5} className="mt-4 w-full">{busy ? <LoaderCircle className="animate-spin" size={16}/> : <ArrowDownLeft size={16}/>} Join room</Button></form></div></div>}
		{showDelete && <div className="fixed inset-0 z-30 grid place-items-center bg-[#1d2823]/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setShowDelete(false); }}><div role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" className="w-full max-w-sm rounded-2xl border border-[#e1e5df] bg-[#fbfcfa] p-6 shadow-2xl"><div className="mb-4 flex items-start justify-between"><div><h2 id="delete-title" className="text-lg font-semibold tracking-tight text-[#25312d]">Permanently delete room?</h2><p id="delete-description" className="mt-2 text-sm leading-6 text-[#79857e]">This permanently deletes room <span className="font-mono font-semibold text-[#25312d]">{room}</span> and every note in it for everyone. This cannot be undone.</p></div><button aria-label="Close dialog" disabled={busy} onClick={() => setShowDelete(false)} className="grid size-8 shrink-0 place-items-center rounded-lg text-[#77827b] hover:bg-[#edf0eb]"><X size={17}/></button></div><label htmlFor="delete-room-code" className="mb-2 block text-sm font-medium text-[#45524b]">Type {room} to confirm</label><input id="delete-room-code" autoCapitalize="characters" value={deleteCode} onChange={(e) => setDeleteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))} maxLength={5} className="h-12 w-full rounded-lg border border-[#d9ded7] bg-white px-4 font-mono text-lg tracking-[0.2em] outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setShowDelete(false)}>Cancel</Button><Button type="button" disabled={busy || deleteCode !== room} onClick={() => void deleteRoom()} className="bg-red-700 text-white hover:bg-red-800">{busy ? <LoaderCircle className="animate-spin" size={16}/> : <Trash2 size={16}/>} Delete permanently</Button></div></div></div>}
	</main>;
}
