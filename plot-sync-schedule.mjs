const PARTS_FORMATTERS = new Map();

function formatter(timeZone) {
  if (!PARTS_FORMATTERS.has(timeZone)) {
    PARTS_FORMATTERS.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }));
  }
  return PARTS_FORMATTERS.get(timeZone);
}

function zonedParts(value, timeZone) {
  return Object.fromEntries(formatter(timeZone).formatToParts(new Date(value))
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

export function localDateKey(value, timeZone = "Europe/Berlin") {
  const parts = zonedParts(value, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addLocalDays(localDate, days) {
  const [year, month, day] = String(localDate).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function localScheduleToIso(localDate, hour, minute, timeZone = "Europe/Berlin") {
  const [year, month, day] = String(localDate).split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = desired;
  for (let pass = 0; pass < 3; pass += 1) {
    const actual = zonedParts(guess, timeZone);
    const actualUtcShape = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += desired - actualUtcShape;
  }
  return new Date(guess).toISOString();
}

export function nextPlotSyncAt(anchorDate, options = {}) {
  const timeZone = options.timeZone || "Europe/Berlin";
  const intervalDays = Number(options.intervalDays) || 3;
  const nextDate = addLocalDays(anchorDate, intervalDays);
  return localScheduleToIso(nextDate, Number(options.hour) || 0, Number(options.minute) || 0, timeZone);
}
