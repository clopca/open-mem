import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn("rounded-xl border border-stone-200 bg-white shadow-sm", className)}
			{...props}
		/>
	);
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("border-b border-stone-100 px-5 py-4", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("px-5 py-4", className)} {...props} />;
}
