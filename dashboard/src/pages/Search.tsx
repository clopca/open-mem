export function Search() {
	return (
		<div className="mx-auto max-w-4xl">
			<div className="mb-8">
				<h1 className="font-serif text-3xl text-stone-900 italic">Search</h1>
				<p className="mt-1 text-sm text-stone-500">
					Full-text and semantic search across all observations
				</p>
			</div>

			<div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white px-8 py-20">
				<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl">
					{"\u{1F50D}"}
				</div>
				<h2 className="text-lg font-semibold text-stone-700">Coming soon</h2>
				<p className="mt-2 max-w-sm text-center text-sm text-stone-400">
					Hybrid search powered by FTS5 and vector embeddings with ranked results and highlighted
					snippets.
				</p>
			</div>
		</div>
	);
}
