// =============================================================================
// open-mem — Entity Repository (Knowledge Graph CRUD)
// =============================================================================

import { randomUUID } from "node:crypto";
import type { Database } from "./database";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type EntityType =
	| "technology"
	| "library"
	| "pattern"
	| "concept"
	| "file"
	| "person"
	| "project"
	| "other";

export interface Entity {
	id: string;
	name: string;
	entityType: EntityType;
	firstSeenAt: string;
	lastSeenAt: string;
	mentionCount: number;
}

export interface EntityRelation {
	id: string;
	sourceEntityId: string;
	targetEntityId: string;
	relationship: string;
	observationId: string;
	createdAt: string;
}

// -----------------------------------------------------------------------------
// DB Row Types
// -----------------------------------------------------------------------------

interface EntityRow {
	id: string;
	name: string;
	entity_type: string;
	first_seen_at: string;
	last_seen_at: string;
	mention_count: number;
}

interface EntityRelationRow {
	id: string;
	source_entity_id: string;
	target_entity_id: string;
	relationship: string;
	observation_id: string;
	created_at: string;
}

interface EntityObservationRow {
	observation_id: string;
}

// -----------------------------------------------------------------------------
// EntityRepository
// -----------------------------------------------------------------------------

export class EntityRepository {
	constructor(private db: Database) {}

	// ---------------------------------------------------------------------------
	// Upsert Entity
	// ---------------------------------------------------------------------------

	upsertEntity(name: string, entityType: EntityType): Entity {
		const id = randomUUID();
		const now = new Date().toISOString();

		this.db.run(
			`INSERT INTO entities (id, name, entity_type, first_seen_at, last_seen_at, mention_count)
			 VALUES (?, ?, ?, ?, ?, 1)
			 ON CONFLICT(name, entity_type) DO UPDATE SET
				mention_count = mention_count + 1,
				last_seen_at = ?`,
			[id, name, entityType, now, now, now],
		);

		// Fetch the actual row (may be existing or newly inserted)
		const row = this.db.get<EntityRow>(
			"SELECT * FROM entities WHERE name = ? AND entity_type = ?",
			[name, entityType],
		);
		if (!row) {
			throw new Error(`Failed to upsert entity: ${name} (${entityType})`);
		}
		return this.mapEntityRow(row);
	}

	// ---------------------------------------------------------------------------
	// Create Relation
	// ---------------------------------------------------------------------------

	createRelation(
		sourceEntityId: string,
		targetEntityId: string,
		relationship: string,
		observationId: string,
	): EntityRelation | null {
		const id = randomUUID();
		const now = new Date().toISOString();

		try {
			this.db.run(
				`INSERT OR IGNORE INTO entity_relations
				 (id, source_entity_id, target_entity_id, relationship, observation_id, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				[id, sourceEntityId, targetEntityId, relationship, observationId, now],
			);
		} catch {
			return null;
		}

		// Fetch the relation (may be existing due to IGNORE)
		const row = this.db.get<EntityRelationRow>(
			`SELECT * FROM entity_relations
			 WHERE source_entity_id = ? AND target_entity_id = ? AND relationship = ?`,
			[sourceEntityId, targetEntityId, relationship],
		);
		return row ? this.mapRelationRow(row) : null;
	}

	// ---------------------------------------------------------------------------
	// Link Observation
	// ---------------------------------------------------------------------------

	linkObservation(entityId: string, observationId: string): void {
		this.db.run(
			"INSERT OR IGNORE INTO entity_observations (entity_id, observation_id) VALUES (?, ?)",
			[entityId, observationId],
		);
	}

	// ---------------------------------------------------------------------------
	// Find by Name (FTS5)
	// ---------------------------------------------------------------------------

	findByName(name: string): Entity[] {
		try {
			const rows = this.db.all<EntityRow>(
				`SELECT e.*
				 FROM entities e
				 JOIN entities_fts fts ON e._rowid = fts.rowid
				 WHERE entities_fts MATCH ?
				 ORDER BY rank`,
				[name],
			);
			return rows.map((r) => this.mapEntityRow(r));
		} catch {
			return [];
		}
	}

	// ---------------------------------------------------------------------------
	// Get Relations
	// ---------------------------------------------------------------------------

	getRelationsFor(entityId: string): EntityRelation[] {
		const rows = this.db.all<EntityRelationRow>(
			`SELECT * FROM entity_relations
			 WHERE source_entity_id = ? OR target_entity_id = ?`,
			[entityId, entityId],
		);
		return rows.map((r) => this.mapRelationRow(r));
	}

	// ---------------------------------------------------------------------------
	// BFS Traversal
	// ---------------------------------------------------------------------------

	traverseRelations(entityId: string, depth = 1): Set<string> {
		const maxDepth = Math.min(depth, 2); // Cap at 2 to prevent explosion
		const visited = new Set<string>();
		const queue: Array<{ id: string; currentDepth: number }> = [
			{ id: entityId, currentDepth: 0 },
		];

		visited.add(entityId);

		while (queue.length > 0) {
			const current = queue.shift()!;
			if (current.currentDepth >= maxDepth) continue;

			const relations = this.getRelationsFor(current.id);
			for (const rel of relations) {
				const neighborId =
					rel.sourceEntityId === current.id ? rel.targetEntityId : rel.sourceEntityId;

				if (!visited.has(neighborId)) {
					visited.add(neighborId);
					queue.push({ id: neighborId, currentDepth: current.currentDepth + 1 });
				}
			}
		}

		return visited;
	}

	// ---------------------------------------------------------------------------
	// Get Observations for Entity
	// ---------------------------------------------------------------------------

	getObservationsForEntity(entityId: string): string[] {
		const rows = this.db.all<EntityObservationRow>(
			"SELECT observation_id FROM entity_observations WHERE entity_id = ?",
			[entityId],
		);
		return rows.map((r) => r.observation_id);
	}

	// ---------------------------------------------------------------------------
	// Get by ID
	// ---------------------------------------------------------------------------

	getById(id: string): Entity | null {
		const row = this.db.get<EntityRow>("SELECT * FROM entities WHERE id = ?", [id]);
		return row ? this.mapEntityRow(row) : null;
	}

	// ---------------------------------------------------------------------------
	// Row Mapping
	// ---------------------------------------------------------------------------

	private mapEntityRow(row: EntityRow): Entity {
		return {
			id: row.id,
			name: row.name,
			entityType: row.entity_type as EntityType,
			firstSeenAt: row.first_seen_at,
			lastSeenAt: row.last_seen_at,
			mentionCount: row.mention_count,
		};
	}

	private mapRelationRow(row: EntityRelationRow): EntityRelation {
		return {
			id: row.id,
			sourceEntityId: row.source_entity_id,
			targetEntityId: row.target_entity_id,
			relationship: row.relationship,
			observationId: row.observation_id,
			createdAt: row.created_at,
		};
	}
}
