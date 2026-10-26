import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'destructive' | 'ghost' | 'outline'; size?: 'default' | 'icon' | 'sm' };

export function Button({ className, variant = 'default', size = 'default', ...props }: Props) {
	return <button className={cn('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8564b2] disabled:pointer-events-none disabled:opacity-50', variant === 'default' && 'bg-[#6d4ca3] text-white hover:bg-[#583b86]', variant === 'destructive' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90', variant === 'outline' && 'border border-[#ded6e9] bg-white text-[#30283f] hover:bg-[#f1edf7]', variant === 'ghost' && 'text-[#716780] hover:bg-[#f0ecf6] hover:text-[#30283f]', size === 'default' && 'h-10 px-4 py-2', size === 'sm' && 'h-8 px-3', size === 'icon' && 'size-9', className)} {...props} />;
}
