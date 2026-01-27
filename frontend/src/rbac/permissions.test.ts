import { describe, it, expect } from 'vitest';
import {
  getDirectionFromTo,
  getZonePermissions,
  getEntityRBACConfig,
  getZoneVisualizationData,
  ZONE_COLORS,
} from './permissions';
import { ZONE_PATTERNS, DEFAULT_RBAC_CONFIG, HexDirection } from './types';
import { Entity, AppState, ToolEntity } from '../state/store';

describe('RBAC Permissions', () => {
  describe('getDirectionFromTo', () => {
    it('returns null for same hex', () => {
      expect(getDirectionFromTo('0,0', '0,0')).toBeNull();
    });

    it('returns E for hex to the east', () => {
      expect(getDirectionFromTo('0,0', '1,0')).toBe('E');
    });

    it('returns W for hex to the west', () => {
      expect(getDirectionFromTo('0,0', '-1,0')).toBe('W');
    });

    it('returns NE for hex to the northeast', () => {
      expect(getDirectionFromTo('0,0', '1,-1')).toBe('NE');
    });

    it('returns NE for hex at (0,-1) - r decreasing', () => {
      // In axial coordinates, (0,-1) is to the NE in pointy-top orientation
      expect(getDirectionFromTo('0,0', '0,-1')).toBe('NE');
    });

    it('returns SW for hex at (0,1) - r increasing', () => {
      // In axial coordinates, (0,1) is to the SW in pointy-top orientation
      expect(getDirectionFromTo('0,0', '0,1')).toBe('SW');
    });

    it('returns SW for hex to the southwest', () => {
      expect(getDirectionFromTo('0,0', '-1,1')).toBe('SW');
    });

    it('returns correct direction for extended range (2 hexes away)', () => {
      // 2 hexes to the east
      expect(getDirectionFromTo('0,0', '2,0')).toBe('E');
      // 2 hexes to the west
      expect(getDirectionFromTo('0,0', '-2,0')).toBe('W');
    });
  });

  describe('getZonePermissions', () => {
    it('returns read+write for readWriteZone', () => {
      const zoneConfig = ZONE_PATTERNS['all-rw'];
      const permissions = getZonePermissions('E', zoneConfig);
      expect(permissions).toContain('read');
      expect(permissions).toContain('write');
      expect(permissions).toContain('execute');
    });

    it('returns only read for readZone', () => {
      const zoneConfig = ZONE_PATTERNS['read-left-write-right'];
      const permissions = getZonePermissions('W', zoneConfig);
      expect(permissions).toContain('read');
      expect(permissions).not.toContain('write');
    });

    it('returns only write for writeZone', () => {
      const zoneConfig = ZONE_PATTERNS['read-left-write-right'];
      const permissions = getZonePermissions('E', zoneConfig);
      expect(permissions).toContain('write');
      expect(permissions).not.toContain('read');
    });

    it('returns empty for directions not in any zone', () => {
      // Custom config with missing directions
      const zoneConfig = {
        readZone: ['E'] as HexDirection[],
        writeZone: ['W'] as HexDirection[],
        readWriteZone: [] as HexDirection[],
        executeInAllZones: true,
      };
      const permissions = getZonePermissions('NE', zoneConfig);
      expect(permissions).toHaveLength(0);
    });

    it('includes execute when executeInAllZones is true', () => {
      const zoneConfig = ZONE_PATTERNS['read-only'];
      const permissions = getZonePermissions('E', zoneConfig);
      expect(permissions).toContain('execute');
    });
  });

  describe('getEntityRBACConfig', () => {
    it('returns default config for entity without rbacConfig', () => {
      const entity = {
        id: 'test-1',
        name: 'Test',
        category: 'agent',
        cost: 0.1,
        status: 'idle',
      } as Entity;

      const config = getEntityRBACConfig(entity);
      expect(config).toEqual(DEFAULT_RBAC_CONFIG);
    });

    it('returns entity rbacConfig when present', () => {
      const customConfig = {
        useZones: true,
        zoneConfig: ZONE_PATTERNS['read-only'],
        defaultPermissions: ['read'] as const,
      };

      const entity = {
        id: 'test-1',
        name: 'Test',
        category: 'tool',
        toolType: 'filesystem',
        cost: 0.1,
        status: 'idle',
        isConfigured: true,
        config: { workspacePath: '/test' },
        linkingMode: 'range',
        range: 2,
        linkedHexes: [],
        rbacConfig: customConfig,
      } as ToolEntity;

      const config = getEntityRBACConfig(entity);
      expect(config.useZones).toBe(true);
      expect(config.zoneConfig).toEqual(ZONE_PATTERNS['read-only']);
    });
  });

  describe('ZONE_COLORS', () => {
    it('has distinct colors for each zone type', () => {
      expect(ZONE_COLORS.read).toBe(0x3b82f6);     // Blue
      expect(ZONE_COLORS.write).toBe(0xf59e0b);    // Amber
      expect(ZONE_COLORS.readwrite).toBe(0x8b5cf6); // Purple
      expect(ZONE_COLORS.none).toBe(0x64748b);     // Slate
    });
  });
});

