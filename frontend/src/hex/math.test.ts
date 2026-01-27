import { describe, it, expect } from 'vitest';
import { 
  getAllNeighbors, 
  hexDistance, 
  hexKey, 
  axialToPixel,
  pixelToAxial,
  hexRound
} from './math';

describe('hex math', () => {
  describe('getAllNeighbors', () => {
    it('returns exactly 6 neighbors', () => {
      const neighbors = getAllNeighbors({ q: 0, r: 0 });
      expect(neighbors).toHaveLength(6);
    });

    it('returns correct neighbor coordinates for origin', () => {
      const neighbors = getAllNeighbors({ q: 0, r: 0 });
      
      // All 6 directions from origin
      expect(neighbors).toContainEqual({ q: 1, r: 0 });   // E
      expect(neighbors).toContainEqual({ q: 1, r: -1 });  // NE
      expect(neighbors).toContainEqual({ q: 0, r: -1 });  // NW
      expect(neighbors).toContainEqual({ q: -1, r: 0 });  // W
      expect(neighbors).toContainEqual({ q: -1, r: 1 }); // SW
      expect(neighbors).toContainEqual({ q: 0, r: 1 });   // SE
    });

    it('works for non-origin hexes', () => {
      const neighbors = getAllNeighbors({ q: 2, r: 3 });
      
      expect(neighbors).toContainEqual({ q: 3, r: 3 });   // E
      expect(neighbors).toContainEqual({ q: 3, r: 2 });   // NE
      expect(neighbors).toContainEqual({ q: 2, r: 2 });   // NW
      expect(neighbors).toContainEqual({ q: 1, r: 3 });   // W
      expect(neighbors).toContainEqual({ q: 1, r: 4 });   // SW
      expect(neighbors).toContainEqual({ q: 2, r: 4 });   // SE
    });

    it('all neighbors are distance 1 from center', () => {
      const center = { q: 5, r: -3 };
      const neighbors = getAllNeighbors(center);
      
      for (const neighbor of neighbors) {
        expect(hexDistance(center, neighbor)).toBe(1);
      }
    });
  });

  describe('hexDistance', () => {
    it('returns 0 for same hex', () => {
      expect(hexDistance({ q: 3, r: 2 }, { q: 3, r: 2 })).toBe(0);
    });

    it('returns 1 for adjacent hexes', () => {
      expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1);
      expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 1 })).toBe(1);
      expect(hexDistance({ q: 0, r: 0 }, { q: -1, r: 1 })).toBe(1);
    });

    it('returns correct distance for farther hexes', () => {
      expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(2);
      expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    });
  });

  describe('hexKey', () => {
    it('creates unique key for coordinates', () => {
      expect(hexKey({ q: 0, r: 0 })).toBe('0,0');
      expect(hexKey({ q: 1, r: -2 })).toBe('1,-2');
      expect(hexKey({ q: -5, r: 3 })).toBe('-5,3');
    });

    it('different coordinates produce different keys', () => {
      const key1 = hexKey({ q: 1, r: 2 });
      const key2 = hexKey({ q: 2, r: 1 });
      expect(key1).not.toBe(key2);
    });
  });

  describe('coordinate conversions', () => {
    it('axialToPixel places origin at 0,0', () => {
      const pixel = axialToPixel({ q: 0, r: 0 });
      expect(pixel.x).toBe(0);
      expect(pixel.y).toBe(0);
    });

    it('pixelToAxial is inverse of axialToPixel', () => {
      const original = { q: 3, r: -2 };
      const pixel = axialToPixel(original);
      const roundTrip = pixelToAxial(pixel);
      
      expect(roundTrip.q).toBe(original.q);
      expect(roundTrip.r).toBe(original.r);
    });
  });

  describe('hexRound', () => {
    it('rounds to nearest hex', () => {
      // Exactly on a hex
      expect(hexRound({ q: 2, r: 3 })).toEqual({ q: 2, r: 3 });
      
      // Slightly off a hex
      expect(hexRound({ q: 2.1, r: 2.9 })).toEqual({ q: 2, r: 3 });
    });
  });
});

