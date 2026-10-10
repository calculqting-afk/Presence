import { GeofenceBoundary } from './GeofenceBoundary.js';
let leafletPromise;
function loadAsset(type, url) {
  return new Promise((resolve, reject) => {
    const element = document.createElement(type === 'style' ? 'link' : 'script');
    if (type === 'style') { element.rel = 'stylesheet'; element.href = url; }
    else { element.src = url; element.async = true; }
    element.onload = () => resolve(element);
    element.onerror = () => { element.remove(); reject(new Error('The map service could not be loaded. Try again.')); };
    document.head.append(element);
  });
}

export function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = Promise.all([
      loadAsset('style', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'),
      window.L ? Promise.resolve() : loadAsset('script', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')
    ]).then(() => {
      if (!window.L) throw new Error('The map service did not initialize.');
      return window.L;
    }).catch(error => { leafletPromise = null; throw error; });
  }
  return leafletPromise;
}

export class GeofenceController {
  constructor(prefix, { showToast }) {
    this.showToast = showToast;
    for (const name of ['Enabled', 'Search', 'SearchButton', 'Radius', 'Address', 'Latitude', 'Longitude', 'Map']) {
      this[name[0].toLowerCase() + name.slice(1)] = document.querySelector(`#${prefix}Geofence${name}`);
    }
    this.revision = 0;
    this.vertices = [];
    this.closed = false;
    this.disposed = false;
    this.listeners = [];
    this.radius.closest('.geofence-fields').insertAdjacentHTML('beforebegin', `<div class="geofence-boundary-tools"><div class="field"><label for="${prefix}GeofenceType">Boundary type</label><select id="${prefix}GeofenceType"><option value="circle">Circle (radius)</option><option value="polygon">Polygon (custom boundary)</option></select></div><div id="${prefix}GeofencePolygonTools" hidden><div class="form-actions"><button type="button" class="outline-button" id="${prefix}GeofenceUndo">Undo last point</button><button type="button" class="outline-button" id="${prefix}GeofenceClearBoundary">Clear boundary</button><button type="button" class="primary-button" id="${prefix}GeofenceCloseBoundary">Close boundary</button></div><small id="${prefix}GeofencePointStatus" role="status" aria-live="polite"></small></div></div>`);
    for (const name of ['Type', 'PolygonTools', 'Undo', 'ClearBoundary', 'CloseBoundary', 'PointStatus']) this[name[0].toLowerCase() + name.slice(1)] = document.querySelector(`#${prefix}Geofence${name}`);
    this.type.value = 'circle';
    this.bind(this.type, 'change', () => this.refreshBoundary());
    this.bind(this.undo, 'click', () => this.undoLastPoint());
    this.bind(this.clearBoundary, 'click', () => this.clearPolygon());
    this.bind(this.closeBoundary, 'click', () => this.closePolygon());
    this.bind(this.radius, 'input', () => this.refreshCircle());
    this.bind(this.searchButton, 'click', () => this.searchPlace());
    this.bind(this.search, 'keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); void this.searchPlace(); }
    });
    this.refreshBoundary();
  }

  bind(target, type, callback) { target.addEventListener(type, callback); this.listeners.push(() => target.removeEventListener(type, callback)); }
  undoLastPoint() { this.closed = false; this.vertices.pop(); this.refreshBoundary(); }
  clearPolygon() { this.closed = false; this.vertices = []; this.refreshBoundary(); }
  closePolygon() {
    try { GeofenceBoundary.create({ type: 'polygon', vertices: this.vertices }); this.closed = true; this.refreshBoundary(); }
    catch (error) { this.showToast('Invalid boundary', error.message); }
  }
  addVertex(lat, lng) {
    if (this.closed) return this.showToast('Boundary closed', 'Use Undo or Clear boundary before changing the shape.');
    if (this.vertices.length >= 10) return this.showToast('Point limit reached', 'Use up to 10 points for a campus boundary.');
    this.vertices.push({ latitude: Number(lat), longitude: Number(lng) });
    this.refreshBoundary();
  }
  refreshBoundary() {
    const polygon = this.type.value === 'polygon';
    this.polygonTools.hidden = !polygon;
    this.radius.closest('.field').hidden = polygon;
    this.latitude.closest('.field').hidden = polygon;
    this.longitude.closest('.field').hidden = polygon;
    this.pointStatus.textContent = `${this.vertices.length}/10 points · ${this.closed ? 'Boundary closed' : 'Click the map to add points, then close the boundary'}`;
    this.undo.disabled = this.vertices.length === 0;
    this.closeBoundary.disabled = this.closed || this.vertices.length < 3;
    if (!this.mapInstance) return;
    for (const layer of [this.polygon, ...(this.vertexMarkers || [])]) if (layer) this.mapInstance.removeLayer(layer);
    this.polygon = null; this.vertexMarkers = [];
    if (polygon) {
      if (this.circle) this.mapInstance.removeLayer(this.circle);
      if (this.marker) this.mapInstance.removeLayer(this.marker);
      this.circle = this.marker = null;
      const points = this.vertices.map(point => [point.latitude, point.longitude]);
      if (points.length > 1) this.polygon = (this.closed ? window.L.polygon : window.L.polyline)(points, { color: '#1f6feb', fillOpacity: .14 }).addTo(this.mapInstance);
      this.vertexMarkers = points.map(point => window.L.circleMarker(point, { radius: 5, color: '#1f6feb' }).addTo(this.mapInstance));
    } else if (this.latitude.value !== '' && this.longitude.value !== '') void this.place(this.latitude.value, this.longitude.value);
  }

  currentRadius() { return Math.max(25, Math.min(5000, Number(this.radius.value) || 100)); }

  async ensureMap() {
    if (this.mapInstance) return this.mapInstance;
    if (!this.mapPromise) {
      this.mapPromise = loadLeaflet().then(L => {
        if (this.disposed) throw new Error('Map editor closed.');
        this.mapInstance = L.map(this.map, { scrollWheelZoom: false }).setView([14.5995, 120.9842], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(this.mapInstance);
        this.mapInstance.on('click', ({ latlng }) => {
          if (this.type.value === 'polygon') this.addVertex(latlng.lat, latlng.lng);
          else void this.place(latlng.lat, latlng.lng);
        });
        if (this.type.value === 'polygon') this.refreshBoundary();
        return this.mapInstance;
      }).catch(error => { this.mapPromise = null; throw error; });
    }
    return this.mapPromise;
  }

  refreshCircle() {
    if (this.type.value === 'polygon' || !this.mapInstance || !this.marker) return;
    if (this.circle) this.circle.setRadius(this.currentRadius());
    else this.circle = window.L.circle(this.marker.getLatLng(), { radius: this.currentRadius(), color: '#1f6feb', fillColor: '#1f6feb', fillOpacity: .14 }).addTo(this.mapInstance);
  }

  async place(lat, lng, label = '') {
    const revision = ++this.revision;
    this.latitude.value = Number(lat).toFixed(6);
    this.longitude.value = Number(lng).toFixed(6);
    if (label) this.address.value = label;
    try {
      const map = await this.ensureMap();
      if (revision !== this.revision) return;
      const point = [Number(lat), Number(lng)];
      if (this.type.value === 'polygon') { map.setView(point, Math.max(map.getZoom(), 17)); return; }
      if (this.marker) this.marker.setLatLng(point);
      else {
        this.marker = window.L.marker(point, { draggable: true }).addTo(map);
        this.marker.on('dragend', () => { const point = this.marker.getLatLng(); void this.place(point.lat, point.lng); });
      }
      this.circle?.setLatLng(point);
      this.refreshCircle();
      map.setView(point, Math.max(map.getZoom(), 17));
    } catch (error) { this.showToast('Map unavailable', error.message); }
  }

  async searchPlace() {
    const text = this.search.value.trim();
    if (!text || this.searchButton.disabled) return;
    this.searchButton.disabled = true;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(text)}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Location search failed. Try again.');
      const [result] = await response.json();
      if (!result) throw new Error('No matching place found.');
      await this.place(result.lat, result.lon, result.display_name);
    } catch (error) { this.showToast('Location search unavailable', error.message); }
    finally { this.searchButton.disabled = false; }
  }

  invalidate() {
    if (!this.map.closest('[hidden]')) void this.ensureMap().then(map => map.invalidateSize()).catch(error => this.showToast('Map unavailable', error.message));
  }

  clear() {
    ++this.revision;
    this.enabled.checked = false;
    this.radius.value = 100;
    this.address.value = this.latitude.value = this.longitude.value = '';
    if (this.marker) this.mapInstance.removeLayer(this.marker);
    if (this.circle) this.mapInstance.removeLayer(this.circle);
    this.marker = this.circle = null;
    this.type.value = 'circle'; this.vertices = []; this.closed = false;
    this.refreshBoundary();
  }

  set(area = {}) {
    this.clear();
    this.enabled.checked = Boolean(area.enabled);
    this.radius.value = area.radiusMeters || 100;
    this.address.value = area.address || '';
    this.type.value = area.type === 'polygon' ? 'polygon' : 'circle';
    this.vertices = (area.vertices || []).map(point => ({ ...point })); this.closed = this.vertices.length >= 3;
    this.refreshBoundary();
    if (this.type.value === 'polygon' && this.vertices.length) {
      const revision = this.revision;
      void this.ensureMap().then(map => { if (revision !== this.revision || this.disposed) return; this.refreshBoundary(); map.fitBounds(this.vertices.map(point => [point.latitude, point.longitude]), { padding: [24, 24], maxZoom: 18 }); }).catch(error => this.showToast('Map unavailable', error.message));
      return;
    }
    if (Number.isFinite(area.latitude) && Number.isFinite(area.longitude)) void this.place(area.latitude, area.longitude, area.address || '');
  }

  value() {
    if (!this.enabled.checked) return { enabled: false };
    if (this.type.value === 'polygon') return { enabled: true, type: 'polygon', vertices: this.vertices.map(point => ({ ...point })), address: this.address.value.trim() };
    return { enabled: this.enabled.checked, type: 'circle', latitude: this.latitude.value === '' ? NaN : Number(this.latitude.value), longitude: this.longitude.value === '' ? NaN : Number(this.longitude.value), radiusMeters: this.currentRadius(), address: this.address.value.trim() };
  }
  validate() {
    const area = this.value();
    if (area.enabled) {
      if (this.type.value === 'polygon' && !this.closed) throw new Error('Close the polygon boundary before saving.');
      GeofenceBoundary.create(area);
    }
    return area;
  }
  dispose() {
    this.disposed = true; ++this.revision;
    this.listeners.forEach(remove => remove()); this.listeners = [];
    this.mapInstance?.remove(); this.mapInstance = null;
  }
}
