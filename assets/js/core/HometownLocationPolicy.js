export const LOCATION_STEPS = ['Region', 'Province', 'City / Municipality', 'Barangay'];

// Broad browsing groups keep the first list short; official PSGC areas remain intact.
export const HOMETOWN_GROUPS = [
  { code: 'metro-manila', name: 'Metro Manila', regions: ['1300000000'] },
  { code: 'mindanao', name: 'Mindanao', regions: ['0900000000', '1000000000', '1100000000', '1200000000', '1600000000', '1900000000'] },
  { code: 'north-luzon', name: 'North Luzon', regions: ['0100000000', '0200000000', '0300000000', '1400000000'] },
  { code: 'south-luzon', name: 'South Luzon', regions: ['0400000000', '0500000000', '1700000000'] },
  { code: 'visayas', name: 'Visayas', regions: ['0600000000', '0700000000', '0800000000', '1800000000'] }
];

export function groupedLocationData(catalog, groupCode) {
  const group = HOMETOWN_GROUPS.find(item => item.code === groupCode);
  if (!group) throw Error('Choose a valid region.');

  const areas = group.regions.map(code => validateRegionData(catalog.areas?.[code]));
  return {
    provinces: areas.flatMap(area => area.provinces),
    cities: areas.flatMap(area => area.cities)
  };
}

export function locationOptions(step, regions, data, selected) {
  if (step === 0) return regions;
  if (!data) return [];
  if (step === 1) {
    const options = [...data.provinces];
    if (data.cities.some(city => !city.province)) options.push({ code: 'independent', name: 'Independent cities / other areas' });
    return options;
  }
  if (step === 2) {
    const provinceCode = selected[1]?.code;
    return data.cities.filter(city => (city.province || 'independent') === provinceCode);
  }
  const city = data.cities.find(item => item.code === selected[2]?.code);
  return (city?.barangays || []).map(([code, name]) => ({ code, name }));
}

export function filterLocations(options, search) {
  const normalize = value => value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
  const needle = normalize(search);

  return options
    .filter(item => normalize(item.name).includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function selectedHometown(selected) {
  if (selected.length !== 4 || selected.some(item => !item?.code || !item?.name)) {
    throw Error('Choose your complete hometown.');
  }
  return {
    hometownBarangay: selected[3].name,
    hometownCity: selected[2].name,
    // NCR and independent cities have no administrative province.
    hometownProvince: selected[1].code === 'independent' ? '' : selected[1].name
  };
}

export function validateRegionData(data) {
  if (!data || !Array.isArray(data.provinces) || !Array.isArray(data.cities)) {
    throw Error('Location lists are unavailable.');
  }

  const validLocation = item => item
    && typeof item.code === 'string'
    && typeof item.name === 'string';
  const validBarangay = row => Array.isArray(row)
    && row.length === 2
    && row.every(value => typeof value === 'string');
  const validCity = city => validLocation(city)
    && typeof city.province === 'string'
    && Array.isArray(city.barangays)
    && city.barangays.every(validBarangay);

  if (!data.provinces.every(validLocation) || !data.cities.every(validCity)) {
    throw Error('Location lists are unavailable.');
  }
  return data;
}
