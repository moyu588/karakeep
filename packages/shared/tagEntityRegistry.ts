/**
 * Entity registry: remembers which tags the tagging model declared as entities
 * (`kind = "entity"`), together with the one-line definition it supplied.
 *
 * Entities are exempt from the `TAG_VOCABULARY_MIN_USAGE` cut-off, because a
 * brand-new product name is necessarily low-usage at first, and the definition
 * is injected next to the name in the canonical vocabulary so the model can
 * reuse the right entity instead of minting a near-duplicate.
 *
 * Pure logic only. The worker persists the serialized form; it lives in the
 * existing key/value `config` table so the plan needs no schema migration.
 */

import { normalizeTagForAbsorption } from "./tagAbsorption";

export const ENTITY_REGISTRY_CONFIG_KEY = "tagEntityRegistry";

export interface EntityRegistryEntry {
  /** Display name, exactly as it was created. */
  name: string;
  /** One-line definition, if the model supplied one. */
  definition?: string;
  /** Epoch millis of the last update (informational). */
  updatedAt: number;
}

export type EntityRegistry = Record<string, EntityRegistryEntry>;

export function entityRegistryKey(name: string): string {
  return normalizeTagForAbsorption(name);
}

/**
 * Parses the persisted registry. Never throws: a corrupt or missing value
 * degrades to an empty registry so tagging keeps working.
 */
export function parseEntityRegistry(
  raw: string | null | undefined,
): EntityRegistry {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const registry: EntityRegistry = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const entry = value as Partial<EntityRegistryEntry>;
      if (typeof entry.name !== "string" || !entry.name.trim()) {
        continue;
      }
      registry[key] = {
        name: entry.name.trim(),
        ...(typeof entry.definition === "string" && entry.definition.trim()
          ? { definition: entry.definition.trim() }
          : {}),
        updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
      };
    }
    return registry;
  } catch {
    return {};
  }
}

export function serializeEntityRegistry(registry: EntityRegistry): string {
  return JSON.stringify(registry);
}

/**
 * Adds or updates entity entries. Existing definitions are preserved when the
 * new suggestion has none, so a later tagging run cannot wipe a good
 * definition by omitting it.
 */
export function upsertEntityEntries(
  registry: EntityRegistry,
  entries: { name: string; definition?: string | null }[],
  now: number,
): EntityRegistry {
  const next: EntityRegistry = { ...registry };
  for (const entry of entries) {
    const name = entry.name.trim();
    const key = entityRegistryKey(name);
    if (!key) {
      continue;
    }
    const definition = entry.definition?.trim();
    const existing = next[key];
    next[key] = {
      name,
      ...(definition
        ? { definition }
        : existing?.definition
          ? { definition: existing.definition }
          : {}),
      updatedAt: now,
    };
  }
  return next;
}

/** Definition lookup by tag name (normalized), for vocabulary rendering. */
export function entityDefinitionFor(
  registry: EntityRegistry,
  name: string,
): string | undefined {
  return registry[entityRegistryKey(name)]?.definition;
}

export function isRegisteredEntity(
  registry: EntityRegistry,
  name: string,
): boolean {
  return entityRegistryKey(name) in registry;
}
