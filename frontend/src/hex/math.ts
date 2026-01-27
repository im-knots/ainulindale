/**
 * Hex coordinate math using axial coordinates (q, r)
 * Flat-top hexagon orientation
 */

export interface AxialCoord {
  q: number;
  r: number;
}

export interface CubeCoord {
  x: number;
  y: number;
  z: number;
}

export interface Point {
  x: number;
  y: number;
}

// Hex size (distance from center to corner)
export const HEX_SIZE = 40;

// Conversion between axial and cube coordinates
export function axialToCube(axial: AxialCoord): CubeCoord {
  return {
    x: axial.q,
    z: axial.r,
    y: -axial.q - axial.r,
  };
}

export function cubeToAxial(cube: CubeCoord): AxialCoord {
  return {
    q: cube.x,
    r: cube.z,
  };
}

// Convert axial coordinates to pixel position (flat-top orientation)
export function axialToPixel(axial: AxialCoord, size: number = HEX_SIZE): Point {
  const x = size * (3 / 2 * axial.q);
  const y = size * (Math.sqrt(3) / 2 * axial.q + Math.sqrt(3) * axial.r);
  return { x, y };
}

// Convert pixel position to axial coordinates
export function pixelToAxial(point: Point, size: number = HEX_SIZE): AxialCoord {
  const q = (2 / 3 * point.x) / size;
  const r = (-1 / 3 * point.x + Math.sqrt(3) / 3 * point.y) / size;
  return hexRound({ q, r });
}

// Round fractional axial coordinates to nearest hex
export function hexRound(axial: AxialCoord): AxialCoord {
  const cube = axialToCube(axial);
  let rx = Math.round(cube.x);
  let ry = Math.round(cube.y);
  let rz = Math.round(cube.z);

  const xDiff = Math.abs(rx - cube.x);
  const yDiff = Math.abs(ry - cube.y);
  const zDiff = Math.abs(rz - cube.z);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return cubeToAxial({ x: rx, y: ry, z: rz });
}

// Direction vectors for the 6 neighbors (flat-top)
const DIRECTIONS: AxialCoord[] = [
  { q: 1, r: 0 },   // E
  { q: 1, r: -1 },  // NE
  { q: 0, r: -1 },  // NW
  { q: -1, r: 0 },  // W
  { q: -1, r: 1 },  // SW
  { q: 0, r: 1 },   // SE
];

export function getNeighbor(axial: AxialCoord, direction: number): AxialCoord {
  const dir = DIRECTIONS[direction];
  return {
    q: axial.q + dir.q,
    r: axial.r + dir.r,
  };
}

export function getAllNeighbors(axial: AxialCoord): AxialCoord[] {
  return DIRECTIONS.map((_, i) => getNeighbor(axial, i));
}

// Distance between two hexes
export function hexDistance(a: AxialCoord, b: AxialCoord): number {
  const ac = axialToCube(a);
  const bc = axialToCube(b);
  return Math.max(
    Math.abs(ac.x - bc.x),
    Math.abs(ac.y - bc.y),
    Math.abs(ac.z - bc.z)
  );
}

// Generate corner points for a hex (flat-top)
export function hexCorners(center: Point, size: number = HEX_SIZE): Point[] {
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    corners.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    });
  }
  return corners;
}

// Create a unique key for a hex coordinate
export function hexKey(axial: AxialCoord): string {
  return `${axial.q},${axial.r}`;
}

