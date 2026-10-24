// Small, dependency-free SpreadsheetML exporter. Only allowlisted report fields
// enter the workbook. All user text is inline text, never an Excel formula/link.
const XML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escape = value => Array.from(String(value ?? '')).filter(character => {
  const code = character.codePointAt(0);
  return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff);
}).join('').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const column = index => { let name = ''; for (index++; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name; return name; };
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function zip(files) {
  const encoder = new TextEncoder(), parts = [], central = []; let offset = 0;
  for (const [filename, content] of files) {
    const name = encoder.encode(filename), data = encoder.encode(content), crc = crc32(data);
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true); l.setUint16(12, 0x21, true);
    l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
    const directory = new Uint8Array(46 + name.length), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(14, 0x21, true);
    d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46);
    parts.push(local, data); central.push(directory); offset += local.length + data.length;
  }
  const directorySize = central.reduce((sum, bytes) => sum + bytes.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directorySize + end.length); let position = 0;
  if (result.length > 10 * 1024 * 1024) throw new Error('Excel export exceeds 10 MB. Select a section or narrower filters.');
  for (const part of [...parts, ...central, end]) { result.set(part, position); position += part.length; }
  return result;
}
const dateCell = (value, offset = 0, dateOnly = false) => {
  const milliseconds = value ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) ? { serial: (milliseconds + offset) / 86400000 + 25569, dateOnly } : 'Not recorded';
};
function worksheet(rows, widths, filter = false) {
  const data = rows.map((row, index) => `<row r="${index + 1}"${index === 0 ? ' ht="30" customHeight="1"' : ''}>${row.map((value, col) => {
    const reference = `${column(col)}${index + 1}`, style = index === 0 ? 1 : value?.serial !== undefined ? value.dateOnly ? 3 : 2 : 0;
    if (value?.serial !== undefined) return `<c r="${reference}" s="${style}"><v>${value.serial}</v></c>`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${XML}"><dimension ref="A1:${column(widths.length - 1)}${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData>${filter ? `<autoFilter ref="A1:${column(widths.length - 1)}${rows.length}"/>` : ''}<pageSetup orientation="landscape" paperSize="9"/></worksheet>`;
}
export class AttendanceExcelExporter {
  async generate(report) {
    if (!Array.isArray(report?.rows) || report.rows.length > 5000) throw new Error('Select a verified attendance report with at most 5,000 rows.');
    const headers = ['Student ID', 'Name', 'Course', 'Year level', 'Section', 'Event', 'Event date', 'Session', 'Check-in (PH)', 'Check-out (PH)', 'Arrival', 'Attendance status'];
    const values = rows => [headers, ...rows.map(row => [
      String(row.studentId ?? ''), row.name, row.course, /^([1-4])[AB]$/.exec(row.section || '')?.[1] || '', row.section,
      report.event.name, dateCell(report.event.date, 0, true), row.sessionLabel || report.filters.session,
      dateCell(row.checkInIso, 8 * 3600000), dateCell(row.checkOutIso, 8 * 3600000), row.arrival, row.completion
    ])];
    const summary = [['Attendance report', 'Value'], ['Event', report.event.name], ['Date', dateCell(report.event.date, 0, true)],
      ['Session', report.filters.session], ['Course', report.filters.course], ['Section', report.filters.section],
      ['Status filter', report.filters.status], ['Search filter', report.filters.search || 'None'], ['Sort order', report.filters.sort],
      ['Time zone', 'Asia/Manila (UTC+08:00)'], ['Generated at (PH)', dateCell(report.generatedAt, 8 * 3600000)],
      ['Last server verification (PH)', dateCell(report.verifiedAt, 8 * 3600000)],
      ...['rows', 'present', 'late', 'completed', 'review', 'absent', 'pending'].map(key => [key === 'rows' ? 'Matching session records' : key[0].toUpperCase() + key.slice(1), report.totals[key] || 0]),
      ['Notes', report.note], ['Year level', 'Derived from the event roster section when available; not a separate historical year record.'],
      ['Snapshot', 'This workbook is a fixed snapshot and does not update. Pending attendance is not an absence. Late/completed totals may overlap with present.']];
    const widths = [20, 34, 20, 12, 12, 38, 16, 16, 24, 24, 20, 25];
    const sheets = [{ name: 'Summary', rows: summary, widths: [35, 95] }];
    if (report.filters.session === 'Both sessions') {
      for (const name of ['Morning', 'Afternoon']) sheets.push({ name, rows: values(report.rows.filter(row => row.sessionLabel === name)), widths, filter: true });
    } else sheets.push({ name: 'Attendance', rows: values(report.rows), widths, filter: true });
    const files = [
      ['[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
      ['_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<workbook xmlns="${XML}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', `<styleSheet xmlns="${XML}"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F5CB5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
      ...sheets.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, worksheet(sheet.rows, sheet.widths, sheet.filter)])
    ];
    return zip(files);
  }
}
