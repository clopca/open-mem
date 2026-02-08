import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn("animate-pulse rounded bg-stone-100", className)}
			aria-hidden="true"
			{...props}
		/>
	);
}
