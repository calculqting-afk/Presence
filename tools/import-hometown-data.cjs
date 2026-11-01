// Refresh the bundled public PSGC reference; no student data is sent to this API.
const fs = require('node:fs');
const path = require('node:path');
const base = 'https://psgc.billyjamesramos.com/api/v1/';
async function get(route) {
  const response = await fetch(base + route, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`${route}: HTTP ${response.status}`);
  return response.json();
}
async function all(route, limit) {
  const first = await get(`${route}?limit=${limit}&page=1`);
  const pages = [first.data];
  for (let page = 2; page <= first.meta.totalPages; page += 4) {
    const batch = await Promise.all(Array.from({ length: Math.min(4, first.meta.totalPages - page + 1) }, (_, i) => get(`${route}?limit=${limit}&page=${page + i}`)));
    pages.push(...batch.map(item => item.data));
  }
  const result = pages.flat();
  if (result.length !== first.meta.total || new Set(result.map(item => item.code)).size !== result.length) throw Error(`Incomplete ${route}`);
  return result;
}
async function main() {
  const [meta, regions, provinces, cities, barangays] = await Promise.all([get('meta'), get('regions'), all('provinces', 100), all('cities-municipalities', 500), all('barangays', 500)]);
  if (regions.data.length !== meta.data.counts.regions || barangays.length !== meta.data.counts.barangays || cities.length !== meta.data.counts.cities + meta.data.counts.municipalities) throw Error('PSGC totals mismatch');
  const folder = path.resolve(__dirname, '../assets/data/hometown');
  const areas = {};
  const knownCities = new Set(cities.map(city => city.code));
  if (barangays.some(item => !knownCities.has(item.cityMunicipalityCode))) throw Error('Barangay has no city/municipality');
  for (const region of regions.data) {
    const localCities = cities.filter(city => city.regionCode === region.code).map(city => ({ code: city.code, name: city.name, province: city.provinceCode || '', barangays: barangays.filter(item => item.cityMunicipalityCode === city.code).map(item => [item.code, item.name]) }));
    areas[region.code] = { provinces: provinces.filter(item => item.regionCode === region.code).map(item => ({ code: item.code, name: item.name })), cities: localCities };
  }
  const catalog = { version: meta.data.version, source: meta.data.sourcePage, sourceFile: meta.data.sourceFile, provider: base, counts: meta.data.counts, regions: regions.data.map(item => ({ code: item.code, name: item.name })), areas };
  // Write only after all requests and consistency checks succeed.
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'locations.json'), JSON.stringify(catalog) + '\n');
  console.log(`Bundled ${regions.data.length} regions, ${provinces.length} provinces, ${cities.length} cities/municipalities and ${barangays.length} barangays (${meta.data.version}).`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
