const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const policy = import(pathToFileURL(path.resolve('assets/js/core/HometownLocationPolicy.js')).href);
const catalog = JSON.parse(fs.readFileSync('assets/data/hometown/locations.json', 'utf8'));

test('catalog class shares concurrent loads and retries failed or invalid responses', async () => {
  const { HometownCatalog } = await import(pathToFileURL(path.resolve('assets/js/controllers/HometownPickerController.js')).href);
  let requests = 0;
  let finishRequest;
  const source = new HometownCatalog(async () => {
    requests += 1;
    return new Promise(resolve => { finishRequest = resolve; });
  });

  const firstLoad = source.load();
  assert.equal(source.load(), firstLoad);
  assert.equal(requests, 1);
  finishRequest({ ok: true, json: async () => catalog });
  assert.equal(await firstLoad, catalog);
  assert.equal(await source.load(), catalog);
  assert.equal(requests, 1);

  let attempts = 0;
  const retrySource = new HometownCatalog(async () => {
    attempts += 1;
    if (attempts === 1) return { ok: false };
    if (attempts === 2) return { ok: true, json: async () => ({ regions: [] }) };
    return { ok: true, json: async () => catalog };
  });
  await assert.rejects(retrySource.load(), /could not be loaded/);
  await assert.rejects(retrySource.load(), /unavailable/);
  assert.equal(await retrySource.load(), catalog);
  assert.equal(attempts, 3);
});

test('bundled PSGC hierarchy covers every reference location, including independent cities', async () => {
  const { validateRegionData, locationOptions } = await policy;
  const index = catalog;
  const totals = { provinces: 0, cities: 0, barangays: 0 };
  const codes = new Set();
  assert.equal(index.regions.length, index.counts.regions);
  for (const region of index.regions) {
    const data = validateRegionData(catalog.areas[region.code]);
    totals.provinces += data.provinces.length; totals.cities += data.cities.length;
    const provinceOptions = locationOptions(1, index.regions, data, [region]);
    for (const city of data.cities) {
      assert.ok(provinceOptions.some(item => item.code === (city.province || 'independent')), city.name + ' unreachable');
      totals.barangays += city.barangays.length;
      for (const [code, name] of city.barangays) {
        assert.ok(!codes.has(code), 'duplicate ' + code); codes.add(code);
        assert.ok(name.length <= 80); assert.ok(city.name.length <= 120);
      }
    }
  }
  assert.equal(totals.provinces, index.counts.provinces);
  assert.equal(totals.cities, index.counts.cities + index.counts.municipalities);
  assert.equal(totals.barangays, index.counts.barangays);
});

test('hometown selection follows Bontoc hierarchy and handles NCR without a province', async () => {
  const { locationOptions, selectedHometown, filterLocations } = await policy;
  const index = catalog;
  const region = index.regions.find(item => item.name.includes('Eastern Visayas'));
  const data = catalog.areas[region.code];
  const province = locationOptions(1, index.regions, data, [region]).find(item => item.name === 'Southern Leyte');
  const city = locationOptions(2, index.regions, data, [region, province]).find(item => item.name === 'Bontoc');
  const barangays = locationOptions(3, index.regions, data, [region, province, city]);
  assert.ok(barangays.length > 0);
  assert.deepEqual(selectedHometown([region, province, city, barangays[0]]), { hometownBarangay: barangays[0].name, hometownCity: 'Bontoc', hometownProvince: 'Southern Leyte' });
  const ncr = index.regions.find(item => item.name.includes('National Capital'));
  const metro = catalog.areas[ncr.code];
  assert.equal(metro.provinces.length, 0);
  const independent = { code: 'independent', name: 'No province' };
  const manila = locationOptions(2, index.regions, metro, [ncr, independent]).find(item => item.name.includes('Manila'));
  const local = locationOptions(3, index.regions, metro, [ncr, independent, manila]);
  assert.ok(local.length > 800, 'Manila districts must not hide barangays');
  assert.equal(selectedHometown([ncr, independent, manila, local[0]]).hometownProvince, '');
  assert.throws(() => selectedHometown([region, province, city]), /complete/);
  assert.equal(filterLocations([{code:'1',name:'Peñafrancia'}], 'penafrancia').length, 1);
  assert.deepEqual(filterLocations(barangays, 'no-matching-place-123'), []);
});

test('five short browsing groups retain all provinces, cities and barangays exactly once', async () => {
  const { HOMETOWN_GROUPS, groupedLocationData, locationOptions } = await policy;
  assert.deepEqual(HOMETOWN_GROUPS.map(item => item.name), ['Metro Manila', 'Mindanao', 'North Luzon', 'South Luzon', 'Visayas']);
  const regionCodes = HOMETOWN_GROUPS.flatMap(item => item.regions);
  assert.deepEqual([...regionCodes].sort(), catalog.regions.map(item => item.code).sort());
  assert.equal(new Set(regionCodes).size, catalog.regions.length);
  const cityCodes = new Set(); let barangays = 0;
  for (const group of HOMETOWN_GROUPS) {
    const data = groupedLocationData(catalog, group.code);
    const provinces = locationOptions(1, HOMETOWN_GROUPS, data, [group]);
    for (const city of data.cities) {
      assert.ok(!cityCodes.has(city.code)); cityCodes.add(city.code);
      assert.ok(provinces.some(item => item.code === (city.province || 'independent')), city.name);
      barangays += city.barangays.length;
    }
  }
  assert.equal(cityCodes.size, catalog.counts.cities + catalog.counts.municipalities);
  assert.equal(barangays, catalog.counts.barangays);
  assert.ok(groupedLocationData(catalog, 'visayas').provinces.some(item => item.name === 'Southern Leyte'));
  assert.equal(groupedLocationData(catalog, 'metro-manila').provinces.length, 0);
  assert.throws(() => groupedLocationData(catalog, 'unknown'), /valid region/);
  assert.throws(() => groupedLocationData({ areas: {} }, 'visayas'), /unavailable/);
});
