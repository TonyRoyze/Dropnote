import { useEffect, useState } from 'react';

type Props = { shared: boolean; activeRoom?: boolean };

export default function ConnectionStatus({ shared, activeRoom = false }: Props) {
	const [connected, setConnected] = useState(false);

	useEffect(() => {
		const syncStatus = () => setConnected(document.documentElement.dataset.connectionConnected === 'true');
		const onConnection = (event: Event) => {
			setConnected((event as CustomEvent<{ connected: boolean }>).detail.connected);
		};
		window.addEventListener('dropnote:connection', onConnection);
		syncStatus();
		return () => window.removeEventListener('dropnote:connection', onConnection);
	}, []);

	return <div className="flex items-center gap-2 text-xs text-[#786f88]">
		<span className={`size-2 rounded-full ${shared ? activeRoom ? connected ? 'bg-[#7654a6]' : 'bg-[#cf9c49]' : 'bg-[#7654a6]' : 'bg-[#a49bb1]'}`} />
		<span>{shared ? activeRoom ? connected ? 'Synced' : 'Connecting' : 'Shared rooms' : 'This browser'}</span>
	</div>;
}
