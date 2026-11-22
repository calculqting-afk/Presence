import { AttendancePdfAssets } from './AttendancePdfAssets.js';

export class AttendancePdfExporter {
  constructor({ assets = new AttendancePdfAssets() } = {}) { this.assets = assets; }
  footer(report) {
    if (report.event.schedules) return report.event.schedules.map(schedule => `${schedule.label}: In ${schedule.checkIn} | Late ${schedule.checkInCutoff} | Out ${schedule.checkOut} | Cutoff ${schedule.checkOutCutoff}`);
    const schedule = report.event.schedule || {};
    return [`Check-in time: ${schedule.checkIn || 'Not set'} | Check-in cutoff: ${schedule.checkInCutoff || 'Not set'}`,
      `Check-out time: ${schedule.checkOut || 'Not set'} | Check-out cutoff: ${schedule.checkOutCutoff || 'Not set'}`];
  }
  header(report) {
    const timestamp = value => {
      const date = new Date(value);
      return Number.isFinite(+date) ? date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }) : 'Not available';
    };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(report.event.date)
      ? new Date(`${report.event.date}T00:00:00+08:00`).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }) : report.event.date;
    const statuses = { 'checked-in': 'Checked in', completed: 'Completed', late: 'Late', review: 'Needs review', absent: 'Absent', pending: 'Pending' };
    const filters = [report.filters.section !== 'All sections' && `Section: ${report.filters.section}`,
      report.filters.session && `Session: ${report.filters.session}`,
      report.filters.course && report.filters.course !== 'All courses' && `Course: ${report.filters.course}`,
      report.filters.status !== 'All statuses' && `Status: ${statuses[report.filters.status] || report.filters.status}`,
      report.filters.search && `Search: ${report.filters.search}`].filter(Boolean).join(' | ');
    const totals = report.totals;
    return {
      schedule: [date, report.event.time].filter(Boolean).join(' | '),
      location: [report.event.location, report.event.audience].filter(Boolean).join(' | '), filters,
      exported: `Exported: ${timestamp(report.generatedAt)} | Updated: ${timestamp(report.verifiedAt)} (PH time)`,
      totals: `${report.event.schedules ? 'Session records' : 'Students'}: ${totals.rows} | Present: ${totals.present} | Absent: ${totals.absent} | Needs review: ${totals.review}`,
      breakdown: `Completed: ${totals.completed} | Late: ${totals.late}${totals.pending ? ` | Pending: ${totals.pending}` : ''}`,
      note: `${report.closed ? 'Event closed.' : 'Event ongoing - attendance is not final.'} Late/completed counts may overlap with present.${report.duplicateCount ? ` ${report.duplicateCount} duplicate record(s) merged.` : ''}`
    };
  }
  async generate(report) {
    const { pdf: { PDFDocument, rgb }, fontkit, font: fontBytes, logo: logoBytes } = await this.assets.load();
    const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
    pdf.setTitle(`Presence - ${report.event.name} - Attendance`); pdf.setAuthor('Presence'); pdf.setSubject('Attendance snapshot');
    const font = await pdf.embedFont(fontBytes, { subset: true }), logo = await pdf.embedPng(logoBytes);
    const supported = new Set(font.getCharacterSet());
    const validate = text => {
      for (const character of String(text)) if (!supported.has(character.codePointAt(0))) throw new Error(`The PDF font cannot display ${character}. Please contact your administrator; the preview is unchanged.`);
      return String(text);
    };
    const wrap = (text, width, size = 8) => {
      const lines = []; let line = '';
      for (const word of validate(text).split(/\s+/)) {
        if (font.widthOfTextAtSize((line ? line + ' ' : '') + word, size) <= width) { line += (line ? ' ' : '') + word; continue; }
        if (line) { lines.push(line); line = ''; }
        for (const character of word) {
          if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ''; }
          line += character;
        }
      }
      if (line || !lines.length) lines.push(line);
      return lines;
    };
    const width = 595.28, height = 841.89, margin = 28, usable = width - margin * 2;
    const blue = rgb(.08, .25, .51), ink = rgb(.08, .13, .22), muted = rgb(.33, .39, .47), lineColor = rgb(.84, .88, .93);
    const headers = ['#', 'Student ID', 'Student', 'Course', 'Section', 'Check-in (PH)', 'Check-out (PH)', 'Arrival', 'Completion'];
    const weights = [28, 60, 104, 52, 38, 74, 74, 58, 72];
    const columns = weights.map(weight => weight / weights.reduce((a, b) => a + b, 0) * usable);
    let page, y, index = 0;
    const text = (value, x, top, size = 8, color = ink) => page.drawText(validate(value), { x, y: top - size, size, font, color });
    const paragraph = (value, size = 8, color = muted) => {
      for (const row of wrap(value, usable, size)) { text(row, margin, y, size, color); y -= size + 4; }
      y -= 3;
    };
    const tableHeader = () => {
      const lines = headers.map((value, i) => wrap(value, columns[i] - 10, 7));
      const headerHeight = Math.max(25, ...lines.map(values => values.length * 10 + 14));
      page.drawRectangle({ x: margin, y: y - headerHeight, width: usable, height: headerHeight, color: blue });
      let x = margin;
      lines.forEach((values, i) => { values.forEach((value, n) => text(value, x + 5, y - 7 - n * 10, 7, rgb(1, 1, 1))); x += columns[i]; });
      y -= headerHeight;
    };
    const newPage = first => {
      if (pdf.getPageCount() >= 200) throw new Error('Report exceeds 200 pages. Select a section or narrower filters.');
      page = pdf.addPage([width, height]); y = height - margin;
      page.drawImage(logo, { x: margin, y: y - 30, width: 30, height: 30 });
      text('PRESENCE', margin + 40, y, 15, blue);
      text(report.school, margin + 40, y - 20, 8, muted); y -= 48;
      paragraph(report.event.name, 12, blue);
      if (first) {
        const header = this.header(report);
        paragraph(header.schedule);
        paragraph(header.location);
        if (header.filters) paragraph(header.filters);
        paragraph(header.exported, 7);
        paragraph(header.totals, 8, blue);
        paragraph(header.breakdown, 8, blue);
        paragraph(header.note, 7);
        paragraph('Confidential | Snapshot only - download again for updates.', 7);
      }
      if (y < 115) throw new Error('Report headings are too long to fit safely. Shorten the event details or search filter.');
      tableHeader();
    };
    newPage(true);
    for (const row of report.rows) {
      const cells = [String(index + 1), row.studentId, row.sessionLabel ? `${row.name} — ${row.sessionLabel}` : row.name, row.course, row.section, row.checkIn, row.checkOut, row.arrival, row.completion + (row.corrected ? ' (manual)' : '')];
      const lines = cells.map((cell, i) => wrap(cell, columns[i] - 10));
      const rowHeight = Math.max(27, ...lines.map(value => value.length * 11 + 12));
      if (rowHeight > 380) throw new Error('A report field is too long to fit safely. Review the student/event details.');
      if (y - rowHeight < 48) newPage(false);
      if (y - rowHeight < 48) throw new Error('A report row is too tall to fit safely with the event heading. Review the student/event details.');
      if (index % 2 === 0) page.drawRectangle({ x: margin, y: y - rowHeight, width: usable, height: rowHeight, color: rgb(.96, .98, 1) });
      let x = margin;
      lines.forEach((values, i) => { values.forEach((value, n) => text(value, x + 5, y - 6 - n * 11)); x += columns[i]; });
      page.drawLine({ start: { x: margin, y: y - rowHeight }, end: { x: width - margin, y: y - rowHeight }, thickness: .4, color: lineColor });
      y -= rowHeight; index++;
      if (index % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!report.rows.length) paragraph('No records match the selected filters.');
    const total = pdf.getPageCount();
    pdf.getPages().forEach((item, i) => {
      page = item;
      this.footer(report).forEach((value, line) => text(value, margin, 36 - line * 12, 7, muted));
      text(`Page ${i + 1} of ${total}`, width - margin - 70, 25, 7, muted);
    });
    return pdf.save();
  }
}
