import { useEffect, useRef, useState } from 'react';
import { Copy, X } from 'lucide-react';

type Entry = { id: string; content: string; number: number };
type Props = { notes: Entry[]; onCopy: (note: Entry) => Promise<boolean>; onClose: () => void };

export default function QuickCopyDialog({ notes, onCopy, onClose }: Props) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState(0);
	const [copying, setCopying] = useState(false);
	const [error, setError] = useState('');
	const search = query.trim().toLowerCase();
	const matches = notes.filter(note => /^\d+$/.test(search)
		? note.number === Number(search)
		: note.content.toLowerCase().includes(search));
	const active = Math.min(selected, Math.max(0, matches.length - 1));

	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		const dialog = dialogRef.current;
		dialog?.showModal();
		return () => { dialog?.close(); previous?.focus(); };
	}, []);

	useEffect(() => {
		dialogRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
	}, [active, query]);

	const copy = async (note: Entry) => {
		if (copying) return;
		setCopying(true); setError('');
		if (await onCopy(note)) onClose();
		else setError('Could not access the clipboard. Try again or copy the note manually.');
		setCopying(false);
	};

	return <dialog ref={dialogRef} aria-labelledby="quick-copy-title" className="quick-copy-dialog" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
		<div className="flex items-center justify-between px-5 pt-5">
			<h2 id="quick-copy-title" className="font-semibold text-[#423a50]">Which note would you like to copy?</h2>
			<button type="button" onClick={onClose} aria-label="Close quick copy" className="note-action"><X size={15}/></button>
		</div>
		<div className="px-5 pb-3 pt-4">
			<input autoFocus aria-label="Find a note by number or text" role="combobox" aria-expanded="true" aria-controls="quick-copy-results" aria-activedescendant={matches[active] ? 'quick-copy-' + matches[active].id : undefined} autoComplete="off" value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(Math.max(0, Math.min(matches.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)))); }
				if (event.key === 'Enter') { event.preventDefault(); if (matches[active]) void copy(matches[active]); }
			}} placeholder="Type a note number or search text…" className="w-full rounded-lg border border-[#ded5ea] bg-white px-3 py-3 text-sm outline-none focus:border-[#7958ad] focus:ring-2 focus:ring-[#7958ad]/15" />
		</div>
		<div id="quick-copy-results" role="listbox" aria-label="Notes to copy" aria-busy={copying} className="max-h-[45vh] overflow-y-auto px-2 pb-2">
			{matches.map((note, index) => <button key={note.id} id={'quick-copy-' + note.id} type="button" role="option" aria-selected={index === active} disabled={copying} tabIndex={-1} onMouseEnter={() => setSelected(index)} onClick={() => void copy(note)} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm text-[#423a50] aria-selected:bg-[#f0eaf8] disabled:opacity-50"><span className="shrink-0 text-xs text-[#81788f]">Note {note.number}</span><span className="min-w-0 flex-1 truncate">{note.content}</span><Copy size={14} className="shrink-0 text-[#81788f]"/></button>)}
			{!matches.length && <p className="px-3 py-6 text-center text-sm text-[#81788f]">{notes.length ? 'No matching notes.' : 'No notes to copy yet.'}</p>}
		</div>
		{error && <p role="alert" className="px-5 pb-3 text-sm text-red-700">{error}</p>}
		<p className="border-t border-[#eee8f5] px-5 py-3 text-xs text-[#81788f]">↑ ↓ to choose · Enter to copy · Esc to close</p>
	</dialog>;
}
