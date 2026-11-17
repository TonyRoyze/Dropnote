import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { ArrowDown, ArrowUp, Check, ChevronLeft, Clipboard, Copy, GripVertical, Pencil, Link2, LoaderCircle, RefreshCw, Send, Trash2, X } from 'lucide-react';
import QuickCopyDialog from './QuickCopyDialog';
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
	const [editingId, setEditingId] = useState('');
	const [editDraft, setEditDraft] = useState('');
	const [oldestFirst, setOldestFirst] = useState(false);
	const [draggingId, setDraggingId] = useState('');
	const [dropId, setDropId] = useState('');
	const visibleNotes = useMemo(() => oldestFirst ? [...notes].reverse() : notes, [notes, oldestFirst]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [copied, setCopied] = useState('');
	const [showQuickCopy, setShowQuickCopy] = useState(false);
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
		try { setOldestFirst(localStorage.getItem('dropnote-oldest-first') === 'true'); } catch { /* Storage may be unavailable. */ }
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
		channel.on('broadcast', { event: 'notes-reordered' }, () => void loadNotes(room));
		channel.on('broadcast', { event: 'notes-changed' }, () => void loadNotes(room));
		channel.subscribe((status) => setConnected(status === 'SUBSCRIBED'));
		channelRef.current = channel;
		return () => { channelRef.current = null; void client.removeChannel(channel); };
	}, [client, room, loadNotes]);

	useEffect(() => {
		const handleShortcut = (event: KeyboardEvent) => {
			if (room && !showDelete && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'g') {
				event.preventDefault();
				if (!event.repeat) setShowQuickCopy(true);
			}
		};
		window.addEventListener('keydown', handleShortcut);
		return () => window.removeEventListener('keydown', handleShortcut);
	}, [room, showDelete]);

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

	const changeNote = async (id: string, action: 'edit' | 'delete') => {
		if (busy || (action === 'edit' && !editDraft.trim())) return;
		if (action === 'delete' && !window.confirm('Delete this note for everyone? This cannot be undone.')) return;
		setBusy(true); setError('');
		try {
			if (client) {
				const { error: changeError } = await client.rpc(action === 'edit' ? 'edit_note' : 'delete_note', {
					p_code: room, p_note_id: id, ...(action === 'edit' ? { p_content: editDraft.trim() } : {}),
				});
				if (changeError) throw changeError;
				await loadNotes(room);
				await channelRef.current?.send({ type: 'broadcast', event: 'notes-changed', payload: {} });
			} else {
				const local = readLocal();
				local[room] = action === 'delete'
					? (local[room] ?? []).filter(note => note.id !== id)
					: (local[room] ?? []).map(note => note.id === id ? { ...note, content: editDraft.trim() } : note);
				localStorage.setItem(localStorageKey, JSON.stringify(local)); setNotes(local[room]);
			}
			setEditingId('');
		} catch (cause) {
			setError((cause as { code?: string }).code === 'PGRST202'
				? 'Note editing and deletion need the updated supabase/setup.sql. Run it in the Supabase SQL Editor, then retry.'
				: 'Could not change this note. Refresh and try again.');
		} finally { setBusy(false); }
	};

	// Move to the target's slot in the displayed order, including when reversed.
	const reorderNote = async (id: string, targetId: string) => {
		if (busy || id === targetId) return;
		const from = visibleNotes.findIndex(note => note.id === id);
		const to = visibleNotes.findIndex(note => note.id === targetId);
		if (from < 0 || to < 0) return;
		const before = oldestFirst ? from < to : from > to;
		setBusy(true); setError('');
		try {
			if (client) {
				const { error: moveError } = await client.rpc('move_note_to', {
					p_code: room, p_note_id: id, p_target_id: targetId, p_before: before,
				});
				if (moveError) throw moveError;
				await loadNotes(room);
				await channelRef.current?.send({ type: 'broadcast', event: 'notes-reordered', payload: {} });
			} else {
				const local = readLocal();
				const next = [...(local[room] ?? [])];
				const current = next.findIndex(note => note.id === id);
				if (current < 0) throw new Error('Note not found');
				const [moved] = next.splice(current, 1);
				const target = next.findIndex(note => note.id === targetId);
				if (target < 0) throw new Error('Target not found');
				next.splice(target + (before ? 0 : 1), 0, moved);
				local[room] = next;
				localStorage.setItem(localStorageKey, JSON.stringify(local)); setNotes(next);
			}
		} catch (cause) {
			setError((cause as { code?: string }).code === 'PGRST202'
				? 'Drag-and-drop needs the updated supabase/setup.sql. Run it in the Supabase SQL Editor, then retry.'
				: 'Could not save the new order. Refresh and try again.');
		} finally { setBusy(false); setDraggingId(''); setDropId(''); }
	};

	const moveNote = (id: string, direction: -1 | 1) => {
		const index = visibleNotes.findIndex(note => note.id === id);
		const target = visibleNotes[index + direction];
		if (target) void reorderNote(id, target.id);
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
		try { await navigator.clipboard.writeText(text); setCopied(id); window.setTimeout(() => setCopied(''), 1500); return true; }
		catch { setError('Clipboard access is unavailable. Select and copy the text instead.'); return false; }
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
				<div className="flex items-center justify-between border-t border-[#f1edf7] px-4 py-3"><span className="flex items-center gap-1.5 text-xs text-[#a198ae]"><span>{draft.length}/10,000</span><span className="hidden items-center gap-1.5 sm:inline-flex"><span>·</span><Kbd>⌘ / Ctrl</Kbd><span>+</span><Kbd>Enter</Kbd><span>to send</span></span></span><Button type="submit" disabled={!draft.trim() || busy} className="rounded-lg">{busy ? <LoaderCircle className="animate-spin" size={16}/> : <Send size={16}/>} Add to room</Button></div>
			</form>
			{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
			<div className="mb-3 mt-9 flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold text-[#4a415a]">Shared notes <span className="ml-1 font-normal text-[#a098ad]">{notes.length}</span></h2><div className="flex flex-wrap items-center gap-2"><Button variant="ghost" size="sm" onClick={() => setShowQuickCopy(true)} className="h-8 gap-1.5 px-2 text-xs"><Copy size={14}/> Quick copy <Kbd>⌘ / Ctrl G</Kbd></Button><label className="flex cursor-pointer items-center gap-2 text-xs text-[#81788f]"><input type="checkbox" checked={oldestFirst} onChange={(event) => { setOldestFirst(event.target.checked); try { localStorage.setItem('dropnote-oldest-first', String(event.target.checked)); } catch { /* Keep the preference for this session. */ } }} /> Oldest first</label><Button variant="ghost" size="sm" aria-label="Refresh shared notes"  onClick={() => void loadNotes(room)} className="h-8 gap-1.5 px-2 text-xs"><RefreshCw size={14}/> Refresh</Button></div></div><p className="mb-3 text-xs text-[#898197]">Drag a note by its handle or use the arrows to reorder. Oldest first reverses the shared order.</p>
			{notes.length === 0 ? <div className="rounded-2xl border border-dashed border-[#ddd5e9] px-6 py-14 text-center"><div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-[#efeaf7] text-[#725498]"><Clipboard size={19}/></div><h3 className="text-sm font-medium text-[#4a415a]">Nothing in the room yet</h3><p className="mt-1 text-sm text-[#928aa0]">Drop in a note, link, or snippet to get started.</p></div> : <div className="relative space-y-3 pl-7 before:absolute before:bottom-0 before:left-3 before:top-0 before:w-px before:bg-[#ddd5e9]">{visibleNotes.map((note, index) => <article key={note.id}
					onDragOver={(event) => { if (draggingId && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropId(note.id); } }}
					onDrop={(event) => { event.preventDefault(); if (draggingId) void reorderNote(draggingId, note.id); setDraggingId(''); setDropId(''); }}
					data-drop-target={dropId === note.id && draggingId !== note.id}
					className="group relative data-[drop-target=true]:ring-2 data-[drop-target=true]:ring-[#7958ad] rounded-2xl border border-[#e5def0] bg-white px-5 py-4 transition-colors before:absolute before:-left-5 before:top-6 before:size-2 before:rounded-full before:bg-[#7958ad] before:ring-4 before:ring-[#f7f4fb] hover:border-[#d4c8e8]"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-[#898197]">{formatTime(note.created_at)} <span className="mx-1 text-[#d2c9de]">/</span> Note {notes.length - notes.findIndex(item => item.id === note.id)}</span><div className="note-controls">
						<div role="group" aria-label="Edit and delete" className="note-action-group">
							<button type="button" className="note-action" aria-label="Edit note" title="Edit note" disabled={busy || !!editingId} onClick={() => { setEditingId(note.id); setEditDraft(note.content); }}><Pencil/></button>
							<button type="button" className="note-action" aria-label="Delete note" title="Delete note" disabled={busy || !!editingId} onClick={() => void changeNote(note.id, 'delete')}><Trash2/></button>
						</div>
						<div role="group" aria-label="Reorder" className="note-action-group">
							<button type="button" className="note-action" aria-label="Move note up" title="Move up" disabled={busy || index === 0} onClick={() => moveNote(note.id, -1)}><ArrowUp/></button>
							<button type="button" className="note-action" aria-label="Move note down" title="Move down" disabled={busy || index === notes.length - 1} onClick={() => moveNote(note.id, 1)}><ArrowDown/></button>
						</div>
						<div role="group" aria-label="Copy" className="note-action-group">
							<button type="button" className="note-action" aria-label="Copy note reference" title={copied === 'ref-' + note.id ? 'Reference copied' : 'Copy reference'} onClick={() => void copyText('dropnote:' + room + ':' + note.id, 'ref-' + note.id)}>{copied === 'ref-' + note.id ? <Check/> : <Link2/>}</button>
							<button type="button" className="note-action" aria-label="Copy note" title={copied === note.id ? 'Copied' : 'Copy note'} onClick={() => void copyText(note.content, note.id)}>{copied === note.id ? <Check/> : <Copy/>}</button>
						</div>
						<button type="button" draggable={!busy && !editingId} disabled={busy || !!editingId} aria-label="Drag to reorder note" title="Drag to reorder" className="note-action note-drag-handle" onDragStart={(event) => { setDraggingId(note.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', note.id); }} onDragEnd={() => { setDraggingId(''); setDropId(''); }}><GripVertical size={16}/></button></div></div>{editingId === note.id ? <form onSubmit={(event) => { event.preventDefault(); void changeNote(note.id, 'edit'); }}><Textarea autoFocus aria-label="Edit note content" value={editDraft} maxLength={10000} rows={4} disabled={busy} onChange={(event) => setEditDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) setEditingId(''); }} /><div className="mt-3 flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setEditingId('')}>Cancel</Button><Button type="submit" disabled={busy || !editDraft.trim()}>Save changes</Button></div></form> : <pre className="overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[#423a50]">{note.content}</pre>}</article>)}</div>}
		</section>
		<p role="status" aria-live="polite" className="sr-only">{copied ? 'Copied to clipboard' : ''}</p>
		{showQuickCopy && <QuickCopyDialog notes={visibleNotes.map(note => ({ ...note, number: notes.length - notes.findIndex(item => item.id === note.id) }))} onCopy={note => copyText(note.content, note.id)} onClose={() => setShowQuickCopy(false)}/>}
		{showDelete && <div className="fixed inset-0 z-30 grid place-items-center bg-[#251d34]/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowDelete(false); }}><div role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" className="w-full max-w-sm rounded-2xl border border-[#e5def0] bg-[#fbf9fe] p-6 shadow-2xl"><div className="mb-4 flex items-start justify-between"><div><h2 id="delete-title" className="text-lg font-semibold tracking-tight text-[#30283f]">Permanently delete room?</h2><p id="delete-description" className="mt-2 text-sm leading-6 text-[#81788f]">This permanently deletes room <span className="font-mono font-semibold text-[#30283f]">{room}</span> and every note in it for everyone. This cannot be undone.</p></div><button aria-label="Close dialog" disabled={busy} onClick={() => setShowDelete(false)} className="grid size-8 shrink-0 place-items-center rounded-lg text-[#7f758e] hover:bg-[#f1edf7]"><X size={17}/></button></div><label htmlFor="delete-room-code" className="mb-2 block text-sm font-medium text-[#4a415a]">Type {room} to confirm</label><input id="delete-room-code" autoCapitalize="characters" value={deleteCode} onChange={(event) => setDeleteCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))} maxLength={5} className="h-12 w-full rounded-lg border border-[#ded5ea] bg-white px-4 font-mono text-lg tracking-[0.2em] outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setShowDelete(false)}>Cancel</Button><Button type="button" variant="destructive" disabled={busy || deleteCode !== room} onClick={() => void deleteRoom()}>{busy ? <LoaderCircle className="animate-spin" size={16}/> : <Trash2 size={16}/>} Delete permanently</Button></div></div></div>}
	</main>;
}
