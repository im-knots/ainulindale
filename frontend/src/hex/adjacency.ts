/**
 * Adjacency Semantics for Ainulindale
 *
 * Physical position on the grid implies relationships:
 * - Within range of Tools → Agent has access to those tool capabilities
 * - Adjacent to Another Agent → Can delegate/coordinate
 *
 * Tool entities have a configurable "range" that determines how many hexes away
 * their effects reach. Default range of 1 means only immediate neighbors.
 *
 * RBAC modes:
 * - 'range': Proximity-based access (default)
 * - 'explicit': Manual links only
 */

import { getAllNeighbors, hexKey, hexDistance, AxialCoord } from './math';
import { AppState, Entity, ToolEntity, LinkingMode } from '../state/store';

// Types of tools that can be shared via adjacency
// Now a string to support dynamic plugin IDs
export type ResourceType = string;

// Default range for entities that don't have one set
export const DEFAULT_RANGE = 1;

export interface AdjacentResource {
  type: ResourceType;
  entityId: string;
  hexKey: string;     // Hex key where this resource is located
  name: string;
  provides: string[]; // What capabilities this resource provides
  distance: number;   // How far away this resource is
  range: number;      // The configured range of this resource
  isExplicitLink: boolean; // Whether this is an explicit link vs range-based
}

export interface EntityCapabilities {
  tools: {                   // Available tools from adjacent ToolEntities
    name: string;
    toolType: string;        // Plugin ID (e.g., 'filesystem', 'shell', 'tasklist', or custom)
    entityId: string;
    distance: number;
    isExplicitLink: boolean;
  }[];
  adjacentAgents: string[];  // Entity IDs of adjacent agents
}

/**
 * Parse a hex key back to coordinates
 */
export function parseHexKey(key: string): AxialCoord {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

/**
 * Get the range of an entity (how far its effects reach)
 * Returns DEFAULT_RANGE for entities without a range property
 */
export function getEntityRange(entity: Entity): number {
  if ('range' in entity && typeof entity.range === 'number') {
    return entity.range;
  }
  return DEFAULT_RANGE;
}

/**
 * Get the linking mode of an entity
 * Returns 'range' for entities without a linkingMode property (default behavior)
 */
export function getEntityLinkingMode(entity: Entity): LinkingMode {
  if ('linkingMode' in entity && typeof entity.linkingMode === 'string') {
    return entity.linkingMode as LinkingMode;
  }
  return 'range';
}

/**
 * Get the explicitly linked hexes for an entity
 * Returns empty array for entities without linkedHexes property
 */
export function getEntityLinkedHexes(entity: Entity): string[] {
  if ('linkedHexes' in entity && Array.isArray(entity.linkedHexes)) {
    return entity.linkedHexes;
  }
  return [];
}

/**
 * Check if a resource entity can reach a target hex
 * Considers both range-based and explicit linking modes
 */
export function canResourceReachHex(
  resourceEntity: Entity,
  resourceHexKey: string,
  targetHexKey: string
): { canReach: boolean; distance: number } {
  const linkingMode = getEntityLinkingMode(resourceEntity);

  if (linkingMode === 'explicit') {
    // Explicit linking mode - check if target is in linkedHexes
    const linkedHexes = getEntityLinkedHexes(resourceEntity);
    const isLinked = linkedHexes.includes(targetHexKey);
    // Distance is 0 for explicit links (direct connection)
    return { canReach: isLinked, distance: isLinked ? 0 : -1 };
  } else {
    // Range-based mode - check distance
    const resourceCoord = parseHexKey(resourceHexKey);
    const targetCoord = parseHexKey(targetHexKey);
    const distance = hexDistance(resourceCoord, targetCoord);
    const range = getEntityRange(resourceEntity);
    return { canReach: distance > 0 && distance <= range, distance };
  }
}

/**
 * Get all hex keys within a given distance from a center hex
 */
export function getHexesWithinRange(centerKey: string, range: number, state: AppState): string[] {
  const center = parseHexKey(centerKey);
  const result: string[] = [];

  for (const [key] of state.hexes) {
    const coord = parseHexKey(key);
    const distance = hexDistance(center, coord);
    if (distance > 0 && distance <= range) {
      result.push(key);
    }
  }

  return result;
}

/**
 * Check if two hexes are adjacent (distance = 1)
 */
export function areHexesAdjacent(hexKey1: string, hexKey2: string): boolean {
  if (hexKey1 === hexKey2) return false;
  
  const coord1 = parseHexKey(hexKey1);
  const neighbors = getAllNeighbors(coord1);
  
  return neighbors.some(n => hexKey(n) === hexKey2);
}

/**
 * Get all entities on hexes adjacent to the given hex
 */
export function getAdjacentEntities(targetHexKey: string, state: AppState): Entity[] {
  const coord = parseHexKey(targetHexKey);
  const neighborCoords = getAllNeighbors(coord);
  
  const adjacentEntities: Entity[] = [];
  
  for (const neighborCoord of neighborCoords) {
    const neighborKey = hexKey(neighborCoord);
    const hex = state.hexes.get(neighborKey);
    
    if (hex?.entityId) {
      const entity = state.entities.get(hex.entityId);
      if (entity) {
        adjacentEntities.push(entity);
      }
    }
  }
  
  return adjacentEntities;
}

/**
 * Get all tool entities that can reach a target hex
 * This checks each tool entity's range or explicit links to see if the target is within reach.
 */
export function getResourcesInRange(targetHexKey: string, state: AppState): AdjacentResource[] {
  const resources: AdjacentResource[] = [];

  // Check all entities to see if they can reach this hex
  for (const [entityHexKey, hex] of state.hexes) {
    if (!hex.entityId) continue;

    const entity = state.entities.get(hex.entityId);
    if (!entity) continue;

    // Only check tool entities
    if (entity.category !== 'tool') {
      continue;
    }

    const toolEntity = entity as ToolEntity;

    // Check if this tool can reach the target hex (considering linking mode)
    const { canReach, distance } = canResourceReachHex(entity, entityHexKey, targetHexKey);
    const entityRange = getEntityRange(entity);
    const linkingMode = getEntityLinkingMode(entity);

    if (canReach) {
      // For explicit links, show distance as "linked" (0) in the resource info
      const effectiveDistance = linkingMode === 'explicit' ? 0 : distance;
      const isExplicitLink = linkingMode === 'explicit';

      // Map tool type to capabilities
      let provides: string[] = [];
      switch (toolEntity.toolType) {
        case 'filesystem':
          provides = ['read', 'write', 'list'];
          break;
        case 'shell':
          provides = ['execute'];
          break;
        case 'tasklist':
          provides = ['list', 'add', 'complete'];
          break;
      }

      resources.push({
        type: toolEntity.toolType,
        entityId: entity.id,
        hexKey: entityHexKey,
        name: entity.name,
        provides,
        distance: effectiveDistance,
        range: entityRange,
        isExplicitLink,
      });
    }
  }

  return resources;
}

/**
 * Get all entities that are within a resource entity's range or explicitly linked
 * This is the inverse of getResourcesInRange - finds what a resource can reach
 */
export function getEntitiesInResourceRange(resourceEntityId: string, state: AppState): { entity: Entity; distance: number; isExplicitLink: boolean }[] {
  // Find the resource entity and its hex
  let resourceHexKey: string | null = null;
  let resourceEntity: Entity | null = null;

  for (const [key, hex] of state.hexes) {
    if (hex.entityId === resourceEntityId) {
      resourceHexKey = key;
      resourceEntity = state.entities.get(resourceEntityId) || null;
      break;
    }
  }

  if (!resourceHexKey || !resourceEntity) {
    return [];
  }

  const linkingMode = getEntityLinkingMode(resourceEntity);
  const result: { entity: Entity; distance: number; isExplicitLink: boolean }[] = [];

  if (linkingMode === 'explicit') {
    // Explicit linking mode - only return explicitly linked entities
    const linkedHexes = getEntityLinkedHexes(resourceEntity);
    for (const linkedHexKey of linkedHexes) {
      const hex = state.hexes.get(linkedHexKey);
      if (!hex?.entityId || hex.entityId === resourceEntityId) continue;

      const entity = state.entities.get(hex.entityId);
      if (entity) {
        result.push({ entity, distance: 0, isExplicitLink: true });
      }
    }
  } else {
    // Range-based mode - find all entities within range
    const resourceCoord = parseHexKey(resourceHexKey);
    const range = getEntityRange(resourceEntity);

    for (const [targetHexKey, hex] of state.hexes) {
      if (!hex.entityId || hex.entityId === resourceEntityId) continue;

      const entity = state.entities.get(hex.entityId);
      if (!entity) continue;

      const hexCoord = parseHexKey(targetHexKey);
      const distance = hexDistance(resourceCoord, hexCoord);

      if (distance > 0 && distance <= range) {
        result.push({ entity, distance, isExplicitLink: false });
      }
    }
  }

  return result;
}

/**
 * Legacy function - Get all resource-providing entities adjacent to a hex (range = 1)
 * @deprecated Use getResourcesInRange instead
 */
export function getAdjacentResources(targetHexKey: string, state: AppState): AdjacentResource[] {
  return getResourcesInRange(targetHexKey, state);
}

/**
 * Get the full capabilities of an entity based on what tools can reach it
 * Uses range-based lookups - tools with larger ranges can provide capabilities from farther away
 */
export function getEntityCapabilities(entityId: string, state: AppState): EntityCapabilities {
  // Find which hex this entity is on
  let entityHexKey: string | null = null;

  for (const [key, hex] of state.hexes) {
    if (hex.entityId === entityId) {
      entityHexKey = key;
      break;
    }
  }

  if (!entityHexKey) {
    return { tools: [], adjacentAgents: [] };
  }

  // Get tools that can reach this entity (using their range)
  const resourcesInRange = getResourcesInRange(entityHexKey, state);

  // Also get adjacent agents (agents don't have range, just adjacency)
  const adjacentEntities = getAdjacentEntities(entityHexKey, state);

  const capabilities: EntityCapabilities = {
    tools: [],
    adjacentAgents: [],
  };

  // Process tools that can reach this entity
  for (const resource of resourcesInRange) {
    const entity = state.entities.get(resource.entityId) as ToolEntity;
    if (entity && entity.category === 'tool') {
      capabilities.tools.push({
        name: entity.name,
        toolType: entity.toolType,
        entityId: entity.id,
        distance: resource.distance,
        isExplicitLink: resource.isExplicitLink,
      });
    }
  }

  // Add adjacent agents (still uses simple adjacency)
  for (const entity of adjacentEntities) {
    if (entity.category === 'agent') {
      capabilities.adjacentAgents.push(entity.id);
    }
  }

  return capabilities;
}
