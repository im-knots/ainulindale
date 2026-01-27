import { AxialCoord, hexKey, hexDistance, axialToPixel } from './math';

export interface HexData {
  coord: AxialCoord;
  key: string;
  entityId?: string;
  isEdge?: boolean; // True if this hex is on the perimeter
}

/**
 * Generates a hexagonal grid of given radius
 */
export class HexGrid {
  private radius: number;
  private hexes: Map<string, HexData>;

  constructor(radius: number) {
    this.radius = radius;
    this.hexes = new Map();
    this.generateGrid();
  }

  private generateGrid(): void {
    const center: AxialCoord = { q: 0, r: 0 };

    for (let q = -this.radius; q <= this.radius; q++) {
      const r1 = Math.max(-this.radius, -q - this.radius);
      const r2 = Math.min(this.radius, -q + this.radius);

      for (let r = r1; r <= r2; r++) {
        const coord: AxialCoord = { q, r };
        const dist = hexDistance(coord, center);
        if (dist <= this.radius) {
          const key = hexKey(coord);
          const isEdge = dist === this.radius;
          this.hexes.set(key, { coord, key, isEdge });
        }
      }
    }
  }

  getHex(coord: AxialCoord): HexData | undefined {
    return this.hexes.get(hexKey(coord));
  }

  getAllHexes(): HexData[] {
    return Array.from(this.hexes.values());
  }

  getRadius(): number {
    return this.radius;
  }

  getEdgeHexes(): HexData[] {
    return Array.from(this.hexes.values()).filter(h => h.isEdge);
  }

  /**
   * Find the nearest edge hex to a given angle (in degrees, 0 = right, counterclockwise)
   */
  getNearestEdgeHexToAngle(angleDegrees: number): HexData | null {
    const edgeHexes = this.getEdgeHexes();
    if (edgeHexes.length === 0) return null;

    const angleRad = (angleDegrees * Math.PI) / 180;
    const targetX = Math.cos(angleRad);
    const targetY = Math.sin(angleRad);

    let nearest: HexData | null = null;
    let bestDot = -Infinity;

    edgeHexes.forEach(hex => {
      const pos = axialToPixel(hex.coord);
      const len = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
      if (len === 0) return;

      // Normalized direction from center to hex
      const nx = pos.x / len;
      const ny = pos.y / len;

      // Dot product with target direction (higher = more aligned)
      const dot = nx * targetX + ny * targetY;
      if (dot > bestDot) {
        bestDot = dot;
        nearest = hex;
      }
    });

    return nearest;
  }
}

