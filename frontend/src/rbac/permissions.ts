/**
 * RBAC Permission Checking for Ainulindale
 *
 * Provides functions to check permissions between entities based on
 * adjacency, linking mode, RBAC configuration, and directional zones.
 */

import { AppState, Entity } from '../state/store';
import { canResourceReachHex, getEntityLinkingMode, parseHexKey, getEntityRange } from '../hex/adjacency';
import { hexDistance } from '../hex/math';
import {
  Permission, RBACConfig, PermissionCheckResult, AccessSummary,
  DEFAULT_RBAC_CONFIG, HexDirection, ZoneConfig
} from './types';

/**
 * Get RBAC config from an entity, or return default if not configured
 */
export function getEntityRBACConfig(entity: Entity): RBACConfig {
  if ('rbacConfig' in entity && entity.rbacConfig) {
    return entity.rbacConfig as RBACConfig;
  }
  return DEFAULT_RBAC_CONFIG;
}

/**
 * Determine which direction a target hex is from a source hex
 * For hexes further than 1 away, returns the primary direction
 *
 * Cardinal directions from top, moving clockwise (relative to camera view at 0, 400, 300):
 * - N (top):          { q: 0, r: -1 }  - screen angle ~270° (negative Y in pixel space)
 * - NE (top-right):   { q: 1, r: -1 }  - screen angle ~330°
 * - SE (bottom-right):{ q: 1, r: 0 }   - screen angle ~30°
 * - S (bottom):       { q: 0, r: 1 }   - screen angle ~90° (positive Y in pixel space)
 * - SW (bottom-left): { q: -1, r: 1 }  - screen angle ~150°
 * - NW (top-left):    { q: -1, r: 0 }  - screen angle ~210°
 *
 * This ensures "top" zones appear at the top of the screen, "bottom" at bottom, etc.
 */
export function getDirectionFromTo(sourceHexKey: string, targetHexKey: string): HexDirection | null {
  const source = parseHexKey(sourceHexKey);
  const target = parseHexKey(targetHexKey);

  const dq = target.q - source.q;
  const dr = target.r - source.r;

  if (dq === 0 && dr === 0) return null; // Same hex

  // For immediate neighbors, use exact direction vectors (cardinal directions)
  if (Math.abs(dq) <= 1 && Math.abs(dr) <= 1 && Math.abs(dq + dr) <= 1) {
    if (dq === 0 && dr === -1) return 'N';   // Top
    if (dq === 1 && dr === -1) return 'NE';  // Top-right
    if (dq === 1 && dr === 0) return 'SE';   // Bottom-right
    if (dq === 0 && dr === 1) return 'S';    // Bottom
    if (dq === -1 && dr === 1) return 'SW';  // Bottom-left
    if (dq === -1 && dr === 0) return 'NW';  // Top-left
  }

  // For extended range, calculate screen-space angle
  // Convert axial to pixel coordinates (flat-top hex)
  const pixelX = 3/2 * dq;
  const pixelY = Math.sqrt(3)/2 * dq + Math.sqrt(3) * dr;

  // Calculate angle in screen space (from camera's perspective)
  // Camera is at (0, 400, 300) looking down, so we use pixelX and pixelY directly
  const angle = Math.atan2(pixelY, pixelX);
  const angleDeg = (angle * 180 / Math.PI + 360) % 360;

  // Map angle to cardinal direction based on screen orientation
  // Each direction covers a 60° cone centered on its primary angle
  // Starting from SE (bottom-right) at 0° and moving clockwise
  if (angleDeg >= 0 && angleDeg < 60) return 'SE';     // ~30° (bottom-right on screen)
  if (angleDeg >= 60 && angleDeg < 120) return 'S';    // ~90° (bottom on screen)
  if (angleDeg >= 120 && angleDeg < 180) return 'SW';  // ~150° (bottom-left)
  if (angleDeg >= 180 && angleDeg < 240) return 'NW';  // ~210° (top-left on screen)
  if (angleDeg >= 240 && angleDeg < 300) return 'N';   // ~270° (top on screen)
  if (angleDeg >= 300 && angleDeg < 360) return 'NE';  // ~330° (top-right on screen)

  return 'SE'; // Default fallback
}

/**
 * Get permissions based on zone configuration and direction
 */
export function getZonePermissions(direction: HexDirection, zoneConfig: ZoneConfig | undefined): Permission[] {
  const permissions: Permission[] = [];

  // If no zone config, return empty permissions (will fall back to default)
  if (!zoneConfig) {
    return permissions;
  }

  // Safely access zone arrays with defaults
  const readWriteZone = zoneConfig.readWriteZone ?? [];
  const readZone = zoneConfig.readZone ?? [];
  const writeZone = zoneConfig.writeZone ?? [];

  if (readWriteZone.includes(direction)) {
    permissions.push('read', 'write');
  } else {
    if (readZone.includes(direction)) {
      permissions.push('read');
    }
    if (writeZone.includes(direction)) {
      permissions.push('write');
    }
  }

  if (zoneConfig.executeInAllZones && permissions.length > 0) {
    permissions.push('execute');
  }

  return permissions;
}

/**
 * Check if an entity has a specific permission to access a resource
 */
export function checkPermission(
  requesterHexKey: string,
  resourceEntity: Entity,
  resourceHexKey: string,
  permission: Permission
): PermissionCheckResult {
  const rbacConfig = getEntityRBACConfig(resourceEntity);

  // Debug: Log RBAC config for troubleshooting
  const entityRbac = 'rbacConfig' in resourceEntity ? resourceEntity.rbacConfig : null;
  console.log(`[checkPermission] Entity ${resourceEntity.name} (${resourceEntity.id.substring(0, 8)}):`, {
    hasRbacConfig: !!entityRbac,
    useZones: rbacConfig.useZones,
    zoneConfigType: rbacConfig.zoneConfig?.readWriteZone?.length === 6 ? 'all-rw' : 'other',
    rawRbacConfig: entityRbac,
  });

  // If RBAC is not enabled, use simple adjacency rules
  if (!rbacConfig.enabled) {
    const { canReach } = canResourceReachHex(resourceEntity, resourceHexKey, requesterHexKey);
    if (canReach) {
      return {
        allowed: true,
        permission,
        reason: 'RBAC disabled - access granted via adjacency',
        grantedVia: 'default',
      };
    }
    return {
      allowed: false,
      permission,
      reason: 'Not in range or linked',
      grantedVia: 'denied',
    };
  }

  // Check deny list first
  if (rbacConfig.denyList.includes(requesterHexKey)) {
    return {
      allowed: false,
      permission,
      reason: 'Hex is in deny list',
      grantedVia: 'denied',
    };
  }

  const linkingMode = getEntityLinkingMode(resourceEntity);

  if (linkingMode === 'explicit') {
    // Check explicit access grants
    const grant = rbacConfig.accessGrants.find(g => g.targetHexKey === requesterHexKey);
    if (grant) {
      const hasPermission = grant.permissions.includes(permission);
      return {
        allowed: hasPermission,
        permission,
        reason: hasPermission
          ? `Granted via explicit access (role: ${grant.role})`
          : `Permission '${permission}' not in grant`,
        grantedVia: 'explicit',
        role: grant.role,
      };
    }
    return {
      allowed: false,
      permission,
      reason: 'No explicit access grant found',
      grantedVia: 'denied',
    };
  } else {
    // Range-based: check if in range
    const { canReach, distance } = canResourceReachHex(resourceEntity, resourceHexKey, requesterHexKey);
    if (!canReach) {
      return {
        allowed: false,
        permission,
        reason: `Not within range (distance: ${distance}, range: ${getEntityRange(resourceEntity)})`,
        grantedVia: 'denied',
      };
    }

    // Use directional zones if enabled
    if (rbacConfig.useZones) {
      const direction = getDirectionFromTo(resourceHexKey, requesterHexKey);
      if (!direction) {
        return {
          allowed: false,
          permission,
          reason: 'Cannot determine direction',
          grantedVia: 'denied',
        };
      }

      const zonePermissions = getZonePermissions(direction, rbacConfig.zoneConfig);
      const hasPermission = zonePermissions.includes(permission);

      return {
        allowed: hasPermission,
        permission,
        reason: hasPermission
          ? `Granted via ${direction} zone (${getZoneName(direction, rbacConfig.zoneConfig)})`
          : `Permission '${permission}' not available in ${direction} zone`,
        grantedVia: 'range',
        role: rbacConfig.defaultRole,
      };
    }

    // Fallback to default permissions if zones disabled
    const hasPermission = rbacConfig.defaultPermissions.includes(permission);
    return {
      allowed: hasPermission,
      permission,
      reason: hasPermission
        ? `Granted via range access (role: ${rbacConfig.defaultRole})`
        : `Permission '${permission}' not in default permissions`,
      grantedVia: 'range',
      role: rbacConfig.defaultRole,
    };
  }
}

/**
 * Get human-readable zone name for a direction
 */
function getZoneName(direction: HexDirection, zoneConfig: ZoneConfig): string {
  if (zoneConfig.readWriteZone.includes(direction)) return 'R/W zone';
  if (zoneConfig.readZone.includes(direction)) return 'Read zone';
  if (zoneConfig.writeZone.includes(direction)) return 'Write zone';
  return 'No access zone';
}

/**
 * Get all permissions a requester has for a resource
 */
export function getPermissions(
  requesterHexKey: string,
  resourceEntity: Entity,
  resourceHexKey: string
): Permission[] {
  const allPermissions: Permission[] = ['read', 'write', 'execute', 'admin'];
  return allPermissions.filter(p =>
    checkPermission(requesterHexKey, resourceEntity, resourceHexKey, p).allowed
  );
}

/**
 * Get access summary for an entity - what resources it can access
 */
export function getAccessSummary(entityHexKey: string, state: AppState): AccessSummary {
  const hex = state.hexes.get(entityHexKey);
  const entityId = hex?.entityId || '';
  const accessibleResources: AccessSummary['accessibleResources'] = [];

  // Check all resource entities
  for (const [resourceHexKey, resourceHex] of state.hexes) {
    if (!resourceHex.entityId || resourceHexKey === entityHexKey) continue;

    const resourceEntity = state.entities.get(resourceHex.entityId);
    if (!resourceEntity) continue;

    // Only check tool entities (resource providers)
    if (resourceEntity.category !== 'tool') {
      continue;
    }

    const permissions = getPermissions(entityHexKey, resourceEntity, resourceHexKey);
    if (permissions.length > 0) {
      const linkingMode = getEntityLinkingMode(resourceEntity);
      const entityCoord = parseHexKey(entityHexKey);
      const resourceCoord = parseHexKey(resourceHexKey);
      const distance = hexDistance(entityCoord, resourceCoord);

      accessibleResources.push({
        resourceEntityId: resourceEntity.id,
        resourceName: resourceEntity.name,
        resourceType: resourceEntity.category,
        permissions,
        grantedVia: linkingMode === 'explicit' ? 'explicit' : 'range',
        distance,
      });
    }
  }

  return { entityId, hexKey: entityHexKey, accessibleResources };
}

// Zone types for visualization
export type ZoneType = 'read' | 'write' | 'readwrite' | 'none';

// Zone visualization data for a single hex in range
export interface ZoneVisualization {
  hexKey: string;
  q: number;
  r: number;
  zoneType: ZoneType;
  direction: HexDirection;
  distance: number;
}

/**
 * Get zone visualization data for a resource entity
 * Returns all hexes in range with their zone type for rendering
 * @param rangeOverride - Optional range override for live preview during slider drag
 */
export function getZoneVisualizationData(
  resourceEntityId: string,
  state: AppState,
  rangeOverride?: number
): ZoneVisualization[] {
  const result: ZoneVisualization[] = [];

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

  if (!resourceHexKey || !resourceEntity) return result;

  const rbacConfig = getEntityRBACConfig(resourceEntity);
  // Use range override if provided (for live preview), otherwise use entity's actual range
  const range = rangeOverride ?? getEntityRange(resourceEntity);
  const linkingMode = getEntityLinkingMode(resourceEntity);
  const resourceCoord = parseHexKey(resourceHexKey);

  // For explicit linking mode, only show linked hexes
  if (linkingMode === 'explicit') {
    if ('linkedHexes' in resourceEntity && Array.isArray(resourceEntity.linkedHexes)) {
      for (const linkedHexKey of resourceEntity.linkedHexes) {
        const linkedCoord = parseHexKey(linkedHexKey);
        const direction = getDirectionFromTo(resourceHexKey, linkedHexKey);
        if (direction) {
          result.push({
            hexKey: linkedHexKey,
            q: linkedCoord.q,
            r: linkedCoord.r,
            zoneType: 'readwrite', // Explicit links have full access by default
            direction,
            distance: hexDistance(resourceCoord, linkedCoord),
          });
        }
      }
    }
    return result;
  }

  // For range-based, calculate zones for all hexes in range
  for (const [targetHexKey] of state.hexes) {
    if (targetHexKey === resourceHexKey) continue;

    const targetCoord = parseHexKey(targetHexKey);
    const distance = hexDistance(resourceCoord, targetCoord);

    if (distance > 0 && distance <= range) {
      const direction = getDirectionFromTo(resourceHexKey, targetHexKey);
      if (!direction) {
        console.warn(`[getZoneVisualizationData] No direction found for ${resourceHexKey} -> ${targetHexKey}`);
        continue;
      }

      let zoneType: ZoneType = 'none';

      if (rbacConfig.useZones) {
        if (rbacConfig.zoneConfig.readWriteZone.includes(direction)) {
          zoneType = 'readwrite';
        } else if (rbacConfig.zoneConfig.readZone.includes(direction)) {
          zoneType = 'read';
        } else if (rbacConfig.zoneConfig.writeZone.includes(direction)) {
          zoneType = 'write';
        }

        // Debug: log when a hex gets 'none' zone type
        if (zoneType === 'none') {
          console.log(`[getZoneVisualizationData] Hex ${targetHexKey} at distance ${distance} in direction ${direction} has no zone permissions`);
          console.log(`  readZone:`, rbacConfig.zoneConfig.readZone);
          console.log(`  writeZone:`, rbacConfig.zoneConfig.writeZone);
          console.log(`  readWriteZone:`, rbacConfig.zoneConfig.readWriteZone);
        }
      } else {
        // If zones disabled, all hexes in range get default permissions
        zoneType = 'readwrite';
      }

      result.push({
        hexKey: targetHexKey,
        q: targetCoord.q,
        r: targetCoord.r,
        zoneType,
        direction,
        distance,
      });
    }
  }

  return result;
}

// Zone colors for visualization (exported for renderer)
export const ZONE_COLORS = {
  read: 0x3b82f6,      // Blue
  write: 0xf59e0b,     // Amber
  readwrite: 0x8b5cf6, // Purple
  none: 0x64748b,      // Slate (dim)
};
