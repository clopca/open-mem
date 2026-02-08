import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";

const variantClasses = {
	default: "bg-stone-900 text-white hover:bg-stone-800",
	outline: "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
	ghost: "text-stone-700 hover:bg-stone-100",
	destructive: "bg-red-600 text-white hover:bg-red-700",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: keyof typeof variantClasses;
};

export function Button({ variant = "default", className, ...props }: ButtonProps) {
	return (
		<button
			className={cn(
				"inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
				variantClasses[variant],
				className,
			)}
			{...props}
		/>
	);
}
