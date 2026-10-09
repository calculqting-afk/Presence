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
    this.radius.addEventListener('input', () => this.refreshCircle());
    this.searchButton.addEventListener('click', () => this.searchPlace());
    this.search.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); void this.searchPlace(); }
    });
  }

  currentRadius() { return Math.max(25, Math.min(5000, Number(this.radius.value) || 100)); }

  async ensureMap() {
    if (this.mapInstance) return this.mapInstance;
    if (!this.mapPromise) {
      this.mapPromise = loadLeaflet().then(L => {
        this.mapInstance = L.map(this.map, { scrollWheelZoom: false }).setView([14.5995, 120.9842], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(this.mapInstance);
        this.mapInstance.on('click', ({ latlng }) => { void this.place(latlng.lat, latlng.lng); });
        return this.mapInstance;
      }).catch(error => { this.mapPromise = null; throw error; });
    }
    return this.mapPromise;
  }

  refreshCircle() {
    if (!this.mapInstance || !this.marker) return;
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
  }

  set(area = {}) {
    this.clear();
    this.enabled.checked = Boolean(area.enabled);
    this.radius.value = area.radiusMeters || 100;
    this.address.value = area.address || '';
    if (Number.isFinite(area.latitude) && Number.isFinite(area.longitude)) void this.place(area.latitude, area.longitude, area.address || '');
  }

  value() {
    return { enabled: this.enabled.checked, latitude: this.latitude.value === '' ? NaN : Number(this.latitude.value), longitude: this.longitude.value === '' ? NaN : Number(this.longitude.value), radiusMeters: this.currentRadius(), address: this.address.value.trim() };
  }
}
