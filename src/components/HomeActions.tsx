import { useEffect, useMemo, useState } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ArrowDownLeft, LoaderCircle, Plus, X } from 'lucide-react';
import { Button } from './ui/button';
import { Kbd } from './ui/kbd';

type Props = { supabaseUrl?: string; supabaseKey?: string };
type Note = { id: string; content: string; created_at: string };
const localStorageKey = 'dropnote-rooms-v1';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
const readLocal = (): Record<string, Note[]> => {
	try { return JSON.parse(localStorage.getItem(localStorageKey) ?? '{}'); } catch { return {}; }
};

export default function HomeActions({ supabaseUrl = '', supabaseKey = '' }: Props) {
	const client = useMemo<SupabaseClient | null>(() => supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null, [supabaseUrl, supabaseKey]);
	const [inputCode, setInputCode] = useState('');
	const [showJoin, setShowJoin] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const createRoom = async () => {
		if (busy) return;
		setBusy(true); setError('');
		let code = makeCode();
		if (client) {
			let created = false;
			for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
				const { data, error: createError } = await client.rpc('create_room', { p_code: code });
				if (!createError && data) created = true;
				else if (createError && !createError.message.toLowerCase().includes('duplicate')) {
					setError('Could not create room. Check your Supabase setup.'); setBusy(false); return;
				} else code = makeCode();
			}
			if (!created) { setError('Could not find an unused room code. Try again.'); setBusy(false); return; }
		} else {
			const local = readLocal(); local[code] = []; localStorage.setItem(localStorageKey, JSON.stringify(local));
		}
		window.location.assign(`/room/?code=${code}`);
	};

	const openRoom = async (value: string) => {
		if (busy) return;
		setBusy(true); setError('');
		const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
		if (code.length !== 5) { setError('Enter a five-character room code.'); setBusy(false); return; }
		if (client) {
			const { error: openError } = await client.rpc('read_notes', { p_code: code });
			if (openError) { setError('Could not open room. Check the code and try again.'); setBusy(false); return; }
		} else if (!readLocal()[code]) {
			setError('That room is empty here. Without Supabase, rooms stay in this browser.'); setBusy(false); return;
		}
		window.location.assign(`/room/?code=${code}`);
	};

	useEffect(() => {
		const onShortcut = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) return;
			if (event.key.toLowerCase() === 'j') {
				event.preventDefault();
				if (!busy) { setError(''); setShowJoin(true); }
			} else if (event.key.toLowerCase() === 'm') {
				event.preventDefault();
				void createRoom();
			}
		};
		window.addEventListener('keydown', onShortcut);
		return () => window.removeEventListener('keydown', onShortcut);
	}, [busy]);

	return <>
		<div className="mt-9 flex flex-col gap-3 sm:flex-row">
			<Button onClick={() => void createRoom()} disabled={busy} className="h-12 rounded-lg px-5">{busy ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />} Make a room <Kbd>⌘/Ctrl</Kbd><Kbd>M</Kbd></Button>
			<Button variant="outline" onClick={() => { setError(''); setShowJoin(true); }} className="h-12 rounded-lg px-5"><ArrowDownLeft size={17} /> Join a room <Kbd>⌘/Ctrl</Kbd><Kbd>J</Kbd></Button>
		</div>
		{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
		{showJoin && <div className="fixed inset-0 z-20 grid place-items-center bg-[#251d34]/30 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowJoin(false); }}><div role="dialog" aria-modal="true" aria-labelledby="join-title" className="w-full max-w-sm rounded-2xl border border-[#e5def0] bg-[#fbf9fe] p-6 shadow-2xl"><div className="mb-4 flex items-start justify-between"><div><h2 id="join-title" className="text-lg font-semibold tracking-tight text-[#30283f]">Join a room</h2><p className="mt-1 text-sm text-[#81788f]">Enter the five-character code someone shared.</p></div><button aria-label="Close dialog" disabled={busy} onClick={() => setShowJoin(false)} className="grid size-8 place-items-center rounded-lg text-[#7f758e] hover:bg-[#f1edf7]"><X size={17}/></button></div><form onSubmit={(event) => { event.preventDefault(); void openRoom(inputCode); }}><input autoFocus autoCapitalize="characters" value={inputCode} onChange={(event) => setInputCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))} placeholder="e.g. K7P4M" maxLength={5} aria-label="Room code" className="h-12 w-full rounded-lg border border-[#ded5ea] bg-white px-4 font-mono text-lg tracking-[0.2em] outline-none focus:border-[#7958ad] focus:ring-2 focus:ring-[#e8def5]" />{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}<Button type="submit" disabled={busy || inputCode.length !== 5} className="mt-4 w-full">{busy ? <LoaderCircle className="animate-spin" size={16}/> : <ArrowDownLeft size={16}/>} Join room</Button></form></div></div>}
	</>;
}
