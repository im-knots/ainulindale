/**
 * RBAC (Role-Based Access Control) Types for Ainulindale
 *
 * Defines roles, permissions, and access rules for hex entities.
 * Integrates with the existing linking modes (range vs explicit).
 *
 * Directional Zones: Each side of a hex can have different permissions.
 * - Read zone: Entities here get read access
 * - Write zone: Entities here get write access
 * - R/W zone: Entities here get both read and write access
 */

// Hex directions (6 cardinal directions from top, moving clockwise)
// Flat-top orientation, relative to camera view at (0, 400, 300):
// N (top), NE (top-right), SE (bottom-right), S (bottom), SW (bottom-left), NW (top-left)
export type HexDirection = 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW';

export const ALL_DIRECTIONS: HexDirection[] = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];

// Direction to axial offset mapping (screen-relative from camera view)
export const DIRECTION_OFFSETS: Record<HexDirection, { q: number; r: number }> = {
  'N':  { q: 0, r: -1 },  // Top of screen
  'NE': { q: 1, r: -1 },  // Top-right
  'SE': { q: 1, r: 0 },   // Bottom-right (moving clockwise)
  'S':  { q: 0, r: 1 },   // Bottom of screen
  'SW': { q: -1, r: 1 },  // Bottom-left
  'NW': { q: -1, r: 0 },  // Top-left
};

// Permission types that can be granted
export type Permission = 'read' | 'write' | 'execute' | 'admin';

// Predefined roles with default permission sets
export type Role = 'owner' | 'operator' | 'executor' | 'viewer';

// Role to permissions mapping
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ['read', 'write', 'execute', 'admin'],
  operator: ['read', 'write', 'execute'],
  executor: ['read', 'execute'],
  viewer: ['read'],
};

// Access grant for a specific hex or entity
export interface AccessGrant {
  targetHexKey: string;           // The hex that is granted access
  targetEntityId?: string;        // Optional: specific entity ID
  role: Role;                     // Role assigned
  permissions: Permission[];      // Explicit permissions (overrides role if provided)
  grantedAt: Date;
  grantedBy?: string;             // Entity ID that granted access
}

// Zone configuration - which directions have which permissions
export interface ZoneConfig {
  readZone: HexDirection[];       // Directions that grant read access
  writeZone: HexDirection[];      // Directions that grant write access
  readWriteZone: HexDirection[];  // Directions that grant both read and write
  executeInAllZones: boolean;     // Whether execute permission is granted in all zones
}

// Predefined zone patterns for easy configuration
export type ZonePattern =
  | 'all-rw'
  | 'read-left-write-right'
  | 'write-left-read-right'
  | 'rw-left-read-right'
  | 'rw-left-write-right'
  | 'read-left-rw-right'
  | 'write-left-rw-right'
  | 'top-read-bottom-write'
  | 'top-write-bottom-read'
  | 'rw-top-read-bottom'
  | 'rw-top-write-bottom'
  | 'read-top-rw-bottom'
  | 'write-top-rw-bottom'
  | 'read-only'
  | 'write-only'
  | 'top-bottom-rw';

export const ZONE_PATTERNS: Record<ZonePattern, ZoneConfig> = {
  'all-rw': {
    readZone: [],
    writeZone: [],
    readWriteZone: ['N', 'NE', 'SE', 'S', 'SW', 'NW'],
    executeInAllZones: true,
  },
  'read-left-write-right': {
    readZone: ['NW', 'SW', 'S'],      // Left side of screen + bottom
    writeZone: ['NE', 'SE', 'N'],     // Right side of screen + top
    readWriteZone: [],
    executeInAllZones: true,
  },
  'write-left-read-right': {
    readZone: ['NE', 'SE', 'N'],      // Right side of screen + top
    writeZone: ['NW', 'SW', 'S'],     // Left side of screen + bottom
    readWriteZone: [],
    executeInAllZones: true,
  },
  'rw-left-read-right': {
    readZone: ['NE', 'SE', 'N'],      // Right side of screen + top
    writeZone: [],
    readWriteZone: ['NW', 'SW', 'S'], // Left side of screen + bottom
    executeInAllZones: true,
  },
  'rw-left-write-right': {
    readZone: [],
    writeZone: ['NE', 'SE', 'N'],     // Right side of screen + top
    readWriteZone: ['NW', 'SW', 'S'], // Left side of screen + bottom
    executeInAllZones: true,
  },
  'read-left-rw-right': {
    readZone: ['NW', 'SW', 'S'],      // Left side of screen + bottom
    writeZone: [],
    readWriteZone: ['NE', 'SE', 'N'], // Right side of screen + top
    executeInAllZones: true,
  },
  'write-left-rw-right': {
    readZone: [],
    writeZone: ['NW', 'SW', 'S'],     // Left side of screen + bottom
    readWriteZone: ['NE', 'SE', 'N'], // Right side of screen + top
    executeInAllZones: true,
  },
  'top-read-bottom-write': {
    readZone: ['N', 'NE', 'NW'], // Top of screen
    writeZone: ['S', 'SE', 'SW'], // Bottom of screen
    readWriteZone: [],
    executeInAllZones: true,
  },
  'top-write-bottom-read': {
    readZone: ['S', 'SE', 'SW'], // Bottom of screen
    writeZone: ['N', 'NE', 'NW'], // Top of screen
    readWriteZone: [],
    executeInAllZones: true,
  },
  'rw-top-read-bottom': {
    readZone: ['S', 'SE', 'SW'], // Bottom of screen
    writeZone: [],
    readWriteZone: ['N', 'NE', 'NW'], // Top of screen
    executeInAllZones: true,
  },
  'rw-top-write-bottom': {
    readZone: [],
    writeZone: ['S', 'SE', 'SW'], // Bottom of screen
    readWriteZone: ['N', 'NE', 'NW'], // Top of screen
    executeInAllZones: true,
  },
  'read-top-rw-bottom': {
    readZone: ['N', 'NE', 'NW'], // Top of screen
    writeZone: [],
    readWriteZone: ['S', 'SE', 'SW'], // Bottom of screen
    executeInAllZones: true,
  },
  'write-top-rw-bottom': {
    readZone: [],
    writeZone: ['N', 'NE', 'NW'], // Top of screen
    readWriteZone: ['S', 'SE', 'SW'], // Bottom of screen
    executeInAllZones: true,
  },
  'top-bottom-rw': {
    readZone: ['SW', 'NW'],      // Left side
    writeZone: ['SE', 'NE'],     // Right side
    readWriteZone: ['N', 'S'],   // Top and bottom
    executeInAllZones: true,
  },
  'read-only': {
    readZone: ['N', 'NE', 'SE', 'S', 'SW', 'NW'],
    writeZone: [],
    readWriteZone: [],
    executeInAllZones: true,
  },
  'write-only': {
    readZone: [],
    writeZone: ['N', 'NE', 'SE', 'S', 'SW', 'NW'],
    readWriteZone: [],
    executeInAllZones: true,
  },
};

// RBAC configuration for a resource entity
export interface RBACConfig {
  enabled: boolean;               // Whether RBAC is enforced
  defaultRole: Role;              // Role granted to entities in range (for range-based linking)
  defaultPermissions: Permission[]; // Permissions granted by default (when zones disabled)
  zoneConfig: ZoneConfig;         // Directional zone configuration
  useZones: boolean;              // Whether to use directional zones
  accessGrants: AccessGrant[];    // Explicit access grants (for explicit linking mode)
  denyList: string[];             // Hex keys explicitly denied access
}

// Default RBAC config for new entities
export const DEFAULT_RBAC_CONFIG: RBACConfig = {
  enabled: true,
  defaultRole: 'executor',
  defaultPermissions: ['read', 'execute'],
  zoneConfig: ZONE_PATTERNS['all-rw'],
  useZones: true,
  accessGrants: [],
  denyList: [],
};

// Zone info for UI display
export const ZONE_PATTERN_INFO: Record<ZonePattern, { name: string; description: string; icon: string }> = {
  'all-rw': {
    name: 'Full Access',
    description: 'All directions have read/write access',
    icon: '🔓',
  },
  'read-left-write-right': {
    name: 'Left Read / Right Write',
    description: 'West side reads, East side writes',
    icon: '↔️',
  },
  'write-left-read-right': {
    name: 'Left Write / Right Read',
    description: 'West side writes, East side reads',
    icon: '↔️',
  },
  'rw-left-read-right': {
    name: 'Left R/W / Right Read',
    description: 'West side has full access, East side reads only',
    icon: '⬅️',
  },
  'rw-left-write-right': {
    name: 'Left R/W / Right Write',
    description: 'West side has full access, East side writes only',
    icon: '⬅️',
  },
  'read-left-rw-right': {
    name: 'Left Read / Right R/W',
    description: 'West side reads only, East side has full access',
    icon: '➡️',
  },
  'write-left-rw-right': {
    name: 'Left Write / Right R/W',
    description: 'West side writes only, East side has full access',
    icon: '➡️',
  },
  'top-read-bottom-write': {
    name: 'Top Read / Bottom Write',
    description: 'Top reads, bottom writes',
    icon: '↕️',
  },
  'top-write-bottom-read': {
    name: 'Top Write / Bottom Read',
    description: 'Top writes, bottom reads',
    icon: '↕️',
  },
  'rw-top-read-bottom': {
    name: 'Top R/W / Bottom Read',
    description: 'Top has full access, bottom reads only',
    icon: '⬆️',
  },
  'rw-top-write-bottom': {
    name: 'Top R/W / Bottom Write',
    description: 'Top has full access, bottom writes only',
    icon: '⬆️',
  },
  'read-top-rw-bottom': {
    name: 'Top Read / Bottom R/W',
    description: 'Top reads only, bottom has full access',
    icon: '⬇️',
  },
  'write-top-rw-bottom': {
    name: 'Top Write / Bottom R/W',
    description: 'Top writes only, bottom has full access',
    icon: '⬇️',
  },
  'top-bottom-rw': {
    name: 'Top R/W, Sides Split',
    description: 'Top has R/W, left reads, right writes',
    icon: '⬡',
  },
  'read-only': {
    name: 'Read Only',
    description: 'All directions have read-only access',
    icon: '👁️',
  },
  'write-only': {
    name: 'Write Only',
    description: 'All directions have write-only access',
    icon: '✏️',
  },
};

// Permission check result
export interface PermissionCheckResult {
  allowed: boolean;
  permission: Permission;
  reason: string;
  grantedVia?: 'range' | 'explicit' | 'default' | 'denied';
  role?: Role;
}

// Access summary for an entity (what it can access and with what permissions)
export interface AccessSummary {
  entityId: string;
  hexKey: string;
  accessibleResources: {
    resourceEntityId: string;
    resourceName: string;
    resourceType: string;
    permissions: Permission[];
    grantedVia: 'range' | 'explicit';
    distance: number;
  }[];
}

// Utility to check if a role has a specific permission
export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

// Utility to get all permissions for a role
export function getPermissionsForRole(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

// Create a new access grant
export function createAccessGrant(
  targetHexKey: string,
  role: Role,
  targetEntityId?: string,
  grantedBy?: string
): AccessGrant {
  return {
    targetHexKey,
    targetEntityId,
    role,
    permissions: getPermissionsForRole(role),
    grantedAt: new Date(),
    grantedBy,
  };
}

// Permission descriptions for UI
export const PERMISSION_INFO: Record<Permission, { name: string; description: string; icon: string }> = {
  read: {
    name: 'Read',
    description: 'View status, metrics, and configuration',
    icon: 'R',
  },
  write: {
    name: 'Write',
    description: 'Modify configuration and settings',
    icon: 'W',
  },
  execute: {
    name: 'Execute',
    description: 'Run commands, use tools, query data',
    icon: 'X',
  },
  admin: {
    name: 'Admin',
    description: 'Full control including delete and RBAC management',
    icon: '*',
  },
};

// Role descriptions for UI
export const ROLE_INFO: Record<Role, { name: string; description: string; icon: string }> = {
  owner: {
    name: 'Owner',
    description: 'Full control over the resource',
    icon: '*',
  },
  operator: {
    name: 'Operator',
    description: 'Can configure and use the resource',
    icon: 'O',
  },
  executor: {
    name: 'Executor',
    description: 'Can use the resource (default for agents)',
    icon: 'X',
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only access to status and metrics',
    icon: 'V',
  },
};

