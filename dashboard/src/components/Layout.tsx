import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

const navItems = [
	{ to: "/", label: "Timeline", icon: "\u{1F550}" },
	{ to: "/sessions", label: "Sessions", icon: "\u{1F4CB}" },
	{ to: "/search", label: "Search", icon: "\u{1F50D}" },
	{ to: "/stats", label: "Stats", icon: "\u{1F4CA}" },
	{ to: "/ops", label: "Ops", icon: "\u{2699}" },
	{ to: "/settings", label: "Settings", icon: "\u2699\uFE0F" },
];

export function Layout() {
	const [sidebarOpen, setSidebarOpen] = useState(false);

	return (
		<div className="flex h-screen overflow-hidden bg-stone-50">
			{sidebarOpen && (
				<div
					className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
					onClick={() => setSidebarOpen(false)}
					onKeyDown={(e) => {
						if (e.key === "Escape") setSidebarOpen(false);
					}}
					role="button"
					tabIndex={0}
					aria-label="Close sidebar"
				/>
			)}

			<aside
				className={`sidebar-grain fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-stone-900 transition-transform duration-300 ease-out lg:static lg:translate-x-0 ${
					sidebarOpen ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				<div className="flex h-16 items-center gap-3 border-b border-stone-800 px-6">
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20">
						<span className="text-sm font-bold text-amber-400" aria-hidden="true">
							m
						</span>
					</div>
					<div>
						<h1 className="font-serif text-lg leading-tight text-stone-100 italic">open-mem</h1>
						<p className="text-[10px] font-medium tracking-widest text-stone-500 uppercase">
							dashboard
						</p>
					</div>
				</div>

				<nav className="flex-1 space-y-1 px-3 py-4" role="navigation" aria-label="Main navigation">
					{navItems.map((item) => (
						<NavLink
							key={item.to}
							to={item.to}
							end={item.to === "/"}
							onClick={() => setSidebarOpen(false)}
							className={({ isActive }) =>
								`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
									isActive
										? "bg-amber-500/10 text-amber-400"
										: "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
								}`
							}
						>
							<span className="text-base" aria-hidden="true">
								{item.icon}
							</span>
							<span>{item.label}</span>
						</NavLink>
					))}
				</nav>

				<div className="border-t border-stone-800 px-6 py-4">
					<p className="text-[11px] text-stone-600">Persistent memory for OpenCode</p>
				</div>
			</aside>

			<div className="flex flex-1 flex-col overflow-hidden">
				<header className="flex h-16 shrink-0 items-center gap-4 border-b border-stone-200 bg-white px-6">
					<button
						type="button"
						onClick={() => setSidebarOpen(true)}
						className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-700 lg:hidden"
						aria-label="Open sidebar"
					>
						<svg
							className="h-5 w-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M4 6h16M4 12h16M4 18h16"
							/>
						</svg>
					</button>
					<div className="flex-1" />
					<div className="flex items-center gap-2">
						<span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
						<span className="text-xs font-medium text-stone-500">Connected</span>
					</div>
				</header>

				<main className="flex-1 overflow-y-auto p-6 lg:p-8">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
