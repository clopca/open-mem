import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";

const variants = {
	default: "border-stone-200 bg-stone-50 text-stone-800",
	destructive: "border-red-200 bg-red-50 text-red-800",
	warning: "border-amber-200 bg-amber-50 text-amber-800",
	success: "border-emerald-200 bg-emerald-50 text-emerald-800",
} as const;

type AlertProps = HTMLAttributes<HTMLDivElement> & {
	variant?: keyof typeof variants;
};

export function Alert({ variant = "default", className, ...props }: AlertProps) {
	return (
		<div
			className={cn("rounded-xl border px-4 py-3 text-sm", variants[variant], className)}
			role={variant === "destructive" ? "alert" : "status"}
			{...props}
		/>
	);
}
