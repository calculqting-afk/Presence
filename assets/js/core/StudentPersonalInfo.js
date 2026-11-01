export const HOMETOWN_FIELDS = Object.freeze({
  hometownBarangay: 80,
  hometownCity: 120,
  hometownProvince: 120
});

const HOMETOWN_LABELS = {
  hometownBarangay: 'barangay',
  hometownCity: 'municipality/city',
  hometownProvince: 'province'
};

export function studentAge(birthday, now = new Date()) {
  if (typeof birthday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    return null;
  }
  const birth = new Date(birthday + 'T00:00:00Z');
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== birthday) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const value = name => Number(parts.find(part => part.type === name).value);
  const [year, month, day] = birthday.split('-').map(Number);
  const birthdayIsUpcoming = value('month') < month
    || (value('month') === month && value('day') < day);
  const age = value('year') - year - (birthdayIsUpcoming ? 1 : 0);
  return age >= 0 ? age : null;
}

export function ageLabel(birthday, now) {
  const age = studentAge(birthday, now);
  return age === null ? 'Not provided' : `${age} ${age === 1 ? 'year' : 'years'} old`;
}

export function hometownFields(values = {}) {
  return Object.fromEntries(Object.entries(HOMETOWN_FIELDS).map(([key, max]) => {
    const value = values[key] === undefined ? '' : values[key];
    if (typeof value !== 'string' || value.length > max) {
      throw Error(`Enter a valid hometown ${HOMETOWN_LABELS[key]} (up to ${max} characters).`);
    }
    return [key, value.trim()];
  }));
}

export function hometownLabel(profile = {}) {
  return Object.keys(HOMETOWN_FIELDS)
    .map(key => typeof profile[key] === 'string' ? profile[key].trim() : '')
    .filter(Boolean)
    .join(', ') || 'Not provided';
}

export function hometownForm(document, prefix) {
  const values = Object.fromEntries(Object.keys(HOMETOWN_FIELDS).map(key => {
    const input = document.querySelector(hometownInputSelector(prefix, key));
    return [key, input?.value ?? ''];
  }));
  return hometownFields(values);
}

export function fillHometownForm(document, prefix, profile) {
  for (const key of Object.keys(HOMETOWN_FIELDS)) {
    const input = document.querySelector(hometownInputSelector(prefix, key));
    if (input) {
      input.value = typeof profile[key] === 'string' ? profile[key] : '';
      input.dispatchEvent?.(new Event('change', { bubbles: true }));
    }
  }
}

function hometownInputSelector(prefix, key) {
  const fieldName = key[0].toUpperCase() + key.slice(1);
  return `#${prefix}${fieldName}`;
}
