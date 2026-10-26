import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'outline'; size?: 'default' | 'icon' | 'sm' };

export function Button({ className, variant = 'default', size = 'default', ...props }: Props) {
	return <button className={cn('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2c6b5a] disabled:pointer-events-none disabled:opacity-50', variant === 'default' && 'bg-[#235c4d] text-white hover:bg-[#194b3e]', variant === 'outline' && 'border border-[#d5d9d2] bg-white text-[#25312d] hover:bg-[#f0f2ee]', variant === 'ghost' && 'text-[#64706b] hover:bg-[#eef1ed] hover:text-[#25312d]', size === 'default' && 'h-10 px-4 py-2', size === 'sm' && 'h-8 px-3', size === 'icon' && 'size-9', className)} {...props} />;
}
