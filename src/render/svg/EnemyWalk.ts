// Base shape vertex generation and path-d string conversion. Vertex lists are
// pure geometry shared by every enemy of the same (shape, radius), so results are
// cached per pair and frozen to keep the cache from being poisoned by callers.

const BASE_VERTEX_CACHE = new Map<string, number[][]>();

export function buildBaseVertices(shape: string, radius: number): number[][] {
  const cacheKey = `${shape}|${radius}`;
  const cached = BASE_VERTEX_CACHE.get(cacheKey);
  if (cached) return cached;
  const vertices = buildShapeVertices(shape, radius);
  for (const vertex of vertices) Object.freeze(vertex);
  Object.freeze(vertices);
  BASE_VERTEX_CACHE.set(cacheKey, vertices);
  return vertices;
}

function buildShapeVertices(shape: string, radius: number): number[][] {
  switch (shape) {
    case "circle":
      return buildCircleVertices(radius, 32);
    case "triangle":
      return buildTriangleVertices(radius);
    case "square":
      return buildSquareVertices(radius);
    case "hexagon":
      return buildHexagonVertices(radius);
    case "cross":
      return buildCrossVertices(radius);
    case "star":
      return buildStarVertices(radius);
    default:
      return buildCircleVertices(radius, 32);
  }
}

function buildCircleVertices(radius: number, count: number): number[][] {
  const verts: number[][] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i * Math.PI * 2) / count;
    verts.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return verts;
}

function buildTriangleVertices(radius: number): number[][] {
  return [
    [0, -radius],
    [radius * 0.866, radius * 0.5],
    [-radius * 0.866, radius * 0.5],
  ];
}

function buildSquareVertices(radius: number): number[][] {
  return [
    [-radius, -radius],
    [radius, -radius],
    [radius, radius],
    [-radius, radius],
  ];
}

function buildHexagonVertices(radius: number): number[][] {
  const verts: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    verts.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return verts;
}

// Twelve-vertex clockwise outline of an axis-aligned plus. The previous eight
// points connected diagonal corners and traced a bow-tie/hourglass instead of
// the cross silhouette.
function buildCrossVertices(radius: number): number[][] {
  const armHalfWidth = radius * 0.3;
  return [
    [-armHalfWidth, -radius],
    [armHalfWidth, -radius],
    [armHalfWidth, -armHalfWidth],
    [radius, -armHalfWidth],
    [radius, armHalfWidth],
    [armHalfWidth, armHalfWidth],
    [armHalfWidth, radius],
    [-armHalfWidth, radius],
    [-armHalfWidth, armHalfWidth],
    [-radius, armHalfWidth],
    [-radius, -armHalfWidth],
    [-armHalfWidth, -armHalfWidth],
  ];
}

function buildStarVertices(radius: number): number[][] {
  const verts: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const radiusVar = i % 2 === 0 ? radius : radius * 0.5;
    verts.push([Math.cos(angle) * radiusVar, Math.sin(angle) * radiusVar]);
  }
  return verts;
}

export function vertsToPathD(verts: number[][]): string {
  if (verts.length === 0) return "";
  let d = `M${verts[0]![0]},${verts[0]![1]}`;
  for (let i = 1; i < verts.length; i++) {
    d += ` L${verts[i]![0]},${verts[i]![1]}`;
  }
  d += " Z";
  return d;
}
