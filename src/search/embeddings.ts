import { type EmbeddingModel, embed } from "ai";

export async function generateEmbedding(
	model: EmbeddingModel,
	text: string,
): Promise<number[] | null> {
	try {
		const { embedding } = await embed({ model, value: text });
		return embedding as number[];
	} catch {
		return null;
	}
}

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	if (denominator === 0) return 0;

	return dotProduct / denominator;
}

export function prepareObservationText(obs: {
	title: string;
	narrative: string;
	concepts: string[];
}): string {
	const parts = [obs.title, obs.narrative];
	if (obs.concepts.length > 0) {
		parts.push(obs.concepts.join(", "));
	}
	return parts.join("\n");
}
