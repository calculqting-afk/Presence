const radians = value => value * Math.PI / 180;
const validPoint = point => point && typeof point.latitude === 'number' && typeof point.longitude === 'number'
  && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
  && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
const distance = (a, b) => {
  const h = Math.sin(radians(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(radians(b.longitude - a.longitude) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
};
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) < 1e-6
  && p.x >= Math.min(a.x, b.x) - 1e-6 && p.x <= Math.max(a.x, b.x) + 1e-6
  && p.y >= Math.min(a.y, b.y) - 1e-6 && p.y <= Math.max(a.y, b.y) + 1e-6;
const intersects = (a, b, c, d) => (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
  || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);

export class CircleGeofence {
  constructor(area) { this.area = area; }
  validate() {
    if (!validPoint(this.area) || !Number.isFinite(this.area.radiusMeters) || this.area.radiusMeters <= 0 || this.area.radiusMeters > 10000) throw new Error('Choose a valid center and radius.');
    return this;
  }
  evaluate(point, allowance = 0) {
    const meters = distance(this.area, point);
    return { inside: meters <= this.area.radiusMeters + allowance, distanceMeters: meters, radiusMeters: this.area.radiusMeters, type: 'circle' };
  }
}

export class PolygonGeofence {
  constructor(area) { this.vertices = area.vertices; }
  project(point) {
    const origin = this.vertices[0];
    return { x: radians(point.longitude - origin.longitude) * 6371000 * Math.cos(radians(origin.latitude)), y: radians(point.latitude - origin.latitude) * 6371000 };
  }
  validate() {
    if (!Array.isArray(this.vertices) || this.vertices.length < 3 || this.vertices.length > 10 || !this.vertices.every(point => validPoint(point) && Math.abs(point.latitude) <= 85)) throw new Error('Draw a boundary with 3 to 10 valid points.');
    if (this.vertices.some(point => distance(this.vertices[0], point) > 10000 || Math.abs(point.longitude - this.vertices[0].longitude) > 180)) throw new Error('Keep the boundary within a 10 km campus area.');
    const points = this.vertices.map(point => this.project(point));
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.1) throw new Error('Remove duplicate boundary points.');
      area += a.x * b.y - b.x * a.y;
      for (let j = i + 1; j < points.length; j++) {
        if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
        if (intersects(a, b, points[j], points[(j + 1) % points.length])) throw new Error('Boundary edges must not cross or touch each other.');
      }
    }
    if (Math.abs(area) < 2) throw new Error('Draw a boundary with a nonzero area.');
    return this;
  }
  evaluate(point, allowance = 0) {
    const p = this.project(point), points = this.vertices.map(vertex => this.project(vertex));
    let inside = false, nearest = Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      nearest = Math.min(nearest, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return { inside: inside || nearest <= allowance + 1e-6, distanceMeters: inside ? 0 : nearest, type: 'polygon' };
  }
}

export class GeofenceBoundary {
  static create(area) {
    if (area?.type && !['circle', 'polygon'].includes(area.type)) throw new Error('Unknown boundary type.');
    return (area?.type === 'polygon' ? new PolygonGeofence(area) : new CircleGeofence(area || {})).validate();
  }
}
