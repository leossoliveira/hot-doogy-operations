export const SALES_TIMEZONE = 'America/New_York';
const formatters = new Map();
const minute = 60000;
const day = 86400000;

function partsAt(value, timezone = SALES_TIMEZONE) {
  if (value == null || value === '') return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  return Object.fromEntries(formatters.get(timezone).formatToParts(instant).map(part => [part.type, part.value]));
}

export function toLocalDateTime(value, timezone = SALES_TIMEZONE) {
  const p = partsAt(value, timezone);
  return p ? `${p.year.padStart(4, '0')}-${p.month}-${p.day}T${p.hour}:${p.minute}` : '';
}

function utcFromParts(year, month, date, hour = 0, minutes = 0, seconds = 0) {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, date);
  value.setUTCHours(hour, minutes, seconds, 0);
  return value.getTime();
}

// Test every offset observed around the local day. Zero matches is a spring gap;
// two matches is the repeated fall hour. Both require a different user selection.
export function parseLocalDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
  const [year, month, date, hour, minutes] = value.split(/[-T:]/).map(Number);
  if (year < 1 || month < 1 || month > 12 || date < 1 || hour > 23 || minutes > 59) return NaN;
  const wall = utcFromParts(year, month, date, hour, minutes);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== date) return NaN;
  const offsets = new Set([-36, 0, 36].map(hours => {
    const sample = wall + hours * 60 * minute, p = partsAt(sample);
    return utcFromParts(Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - sample;
  }));
  const candidates = [...offsets].map(offset => wall - offset).filter(candidate => toLocalDateTime(candidate) === value);
  return candidates.length === 1 ? candidates[0] : NaN;
}

export function validatePeriodRange(range) {
  if (!range?.start || !range?.end) return "Choose a start and end date and time.";
  const start = parseLocalDateTime(range.start), end = parseLocalDateTime(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Enter valid dates and times in New York. Ambiguous or nonexistent times during daylight saving transitions are not accepted.";
  if (end <= start) return "The end must be after the start.";
  return null;
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function aggregate(rows) {
  const days = new Map();
  for (const row of rows) {
    const key = `${row.date}:${row.locationId}`;
    if (!days.has(key)) days.set(key, { date: row.date, locationId: row.locationId, locationName: row.locationName ?? null, grossSales: 0, discounts: 0, refunds: 0, netSales: 0, quantity: 0, factCount: 0 });
    const target = days.get(key);
    for (const field of ['grossSales', 'discounts', 'netSales', 'quantity', 'factCount']) target[field] += numeric(row[field]);
    target.refunds = target.refunds == null || row.refunds == null ? null : target.refunds + numeric(row.refunds);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date) || String(a.locationId).localeCompare(String(b.locationId)));
}

function covers(intervals, start, end) {
  let cursor = start;
  for (const interval of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (interval[1] <= cursor) continue;
    if (interval[0] > cursor) return false;
    cursor = Math.max(cursor, interval[1]);
    if (cursor >= end) return true;
  }
  return false;
}

function nextDate(date) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + day).toISOString().slice(0, 10);
}

export function calculateSalesPeriod(data, store = 'all', range) {
  const error = validatePeriodRange(range);
  if (error) throw new Error(error);
  const start = parseLocalDateTime(range.start), end = parseLocalDateTime(range.end);
  const previousStart = start - (end - start), previousEnd = start;
  const source = data.salesPeriods;
  const transactional = Array.isArray(source?.facts) && (source.meta?.precision === 'transaction' || source.facts.length > 0 && source.facts.every(fact => fact.granularity === 'transaction'));
  const precision = transactional ? 'transaction' : 'day';
  const matchesStore = row => store === 'all' || row.locationId === store;
  let current, previous, previousCanBeExact = true, coverage;
  if (transactional) {
    const facts = source.facts.filter(matchesStore).map(fact => {
      const at = Date.parse(fact.occurredAt ?? fact.periodStart);
      if (!Number.isFinite(at)) throw new Error("A sale in this export has an invalid time. Reload the data before filtering.");
      return { ...fact, at, date: toLocalDateTime(at).slice(0, 10), factCount: 1 };
    });
    current = aggregate(facts.filter(fact => fact.at >= start && fact.at < end));
    previous = aggregate(facts.filter(fact => fact.at >= previousStart && fact.at < previousEnd));
    const locationIds = store === 'all' ? [...new Set((data.locations?.length ? data.locations : source.batches?.length ? source.batches.map(batch => ({ id: batch.locationId })) : facts.map(fact => ({ id: fact.locationId }))).map(location => location.id))] : [store];
    coverage = (from, to) => locationIds.length > 0 && locationIds.every(locationId => {
      const batches = (source.batches || []).filter(batch => batch.locationId === locationId).map(batch => [Date.parse(batch.periodStart), Date.parse(batch.periodEnd)]);
      if (batches.length) return covers(batches, from, to);
      const bounds = [Date.parse(source.meta?.coverageStart), Date.parse(source.meta?.coverageEndExclusive)];
      return bounds.every(Number.isFinite) && covers([bounds], from, to);
    });
  } else {
    if (!range.start.endsWith('T00:00') || !range.end.endsWith('T00:00')) throw new Error("This export contains daily totals only. Select full days, from midnight to midnight, to avoid estimating hourly sales.");
    const rows = (data.salesDaily || []).filter(matchesStore).map(row => ({ ...row, at: parseLocalDateTime(`${row.date}T00:00`) }));
    current = aggregate(rows.filter(row => row.at >= start && row.at < end));
    previousCanBeExact = toLocalDateTime(previousStart).endsWith('T00:00');
    previous = previousCanBeExact ? aggregate(rows.filter(row => row.at >= previousStart && row.at < previousEnd)) : [];
    const locationIds = store === 'all' ? [...new Set((data.locations?.length ? data.locations.map(location => location.id) : rows.map(row => row.locationId)))] : [store];
    coverage = (from, to) => locationIds.length > 0 && locationIds.every(locationId => covers(rows.filter(row => row.locationId === locationId).map(row => [row.at, parseLocalDateTime(`${nextDate(row.date)}T00:00`)]), from, to));
  }
  const locationNames = new Map((data.locations || []).map(location => [location.id, location.name]));
  for (const row of [...current, ...previous]) row.locationName = locationNames.get(row.locationId) ?? row.locationName;
  const total = current.reduce((value, row) => value + row.netSales, 0);
  const previousTotal = previous.reduce((value, row) => value + row.netSales, 0);
  const currentComplete = coverage(start, end), previousComplete = previousCanBeExact && coverage(previousStart, previousEnd);
  const notices = [];
  if (!currentComplete) notices.push("Imports do not cover the full selected period. Totals include only available sales.");
  if (!previousCanBeExact) notices.push("The comparison period crosses a daylight saving transition and requires timestamps that are not included in the daily export.");
  else if (!previousComplete) notices.push("The previous period is not fully covered, so a percentage change cannot be calculated.");
  if (previousTotal < 0) notices.push("Percentage change is unavailable because the previous period has negative net sales.");
  return {
    current, previous, total, previousTotal,
    quantity: current.reduce((value, row) => value + row.quantity, 0),
    factCount: current.reduce((value, row) => value + row.factCount, 0),
    growth: currentComplete && previousComplete && previousTotal > 0 ? (total / previousTotal - 1) * 100 : null,
    dates: [...new Set(current.map(row => row.date))],
    range: { start: range.start, end: range.end, startUtc: new Date(start).toISOString(), endUtc: new Date(end).toISOString(), previousStartUtc: new Date(previousStart).toISOString(), previousEndUtc: new Date(previousEnd).toISOString(), timezone: SALES_TIMEZONE, endExclusive: true },
    precision, currentComplete, previousComplete, coverageNotice: notices.join(' ') || null,
  };
}

// UI dates are inclusive; the internal upper bound includes the entire 11:59 PM minute.
export function fullDayRange(startDate,endDate){
  if(!Number.isFinite(parseLocalDateTime(`${startDate}T00:00`))||!Number.isFinite(parseLocalDateTime(`${endDate}T00:00`)))throw new Error("Enter valid dates.");
  if(endDate<startDate)throw new Error("The end date must be on or after the start date.");
  return {start:`${startDate}T00:00`,end:`${nextDate(endDate)}T00:00`};
}
export function inclusivePeriodDates(range){
  return {start:range.start.slice(0,10),end:toLocalDateTime(parseLocalDateTime(range.end)-1).slice(0,10)};
}
