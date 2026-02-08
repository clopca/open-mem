import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";

const styles = {
	default: "bg-stone-900 text-white",
	outline: "border border-stone-300 text-stone-700",
	success: "bg-emerald-100 text-emerald-800",
	warning: "bg-amber-100 text-amber-800",
	danger: "bg-red-100 text-red-800",
	muted: "bg-stone-100 text-stone-600",
} as const;

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
	variant?: keyof typeof styles;
};

export function Badge({ variant = "default", className, ...props }: BadgeProps) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
				styles[variant],
				className,
			)}
			{...props}
		/>
	);
}
