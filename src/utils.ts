import { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import * as lzString from 'lz-string';
import { ChartCardConfig, EntityCachePoints } from './types';
import { TinyColor } from '@ctrl/tinycolor';
import parse from 'parse-duration';
import { ChartCardExternalConfig, ChartCardPrettyTime, ChartCardSeriesExternalConfig } from './types-config';
import { DEFAULT_FLOAT_PRECISION, DEFAULT_MAX, DEFAULT_MIN, NO_VALUE } from './const';
import { formatNumber, FrontendLocaleData, HomeAssistant } from 'custom-card-helpers';
import { OverrideFrontendLocaleData } from './types-ha';

export function compress(data: unknown): string {
  return lzString.compress(JSON.stringify(data));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decompress(data: unknown | undefined): any | undefined {
  if (data !== undefined && typeof data === 'string') {
    const dec = lzString.decompress(data);
    return dec && JSON.parse(dec);
  }
  return data;
}

export function getMilli(hours: number): number {
  return hours * 60 ** 2 * 10 ** 3;
}

export function log(message: unknown): void {
  // eslint-disable-next-line no-console
  console.warn('apexcharts-card: ', message);
}

/**
 * Performs a deep merge of `source` into `target`.
 * Mutates `target` only but not its objects and arrays.
 *
 * @author inspired by [jhildenbiddle](https://stackoverflow.com/a/48218209).
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
export function mergeDeep(target: any, source: any): any {
  const isObject = (obj) => obj && typeof obj === 'object';

  if (!isObject(target) || !isObject(source)) {
    return source;
  }

  Object.keys(source).forEach((key) => {
    const targetValue = target[key];
    const sourceValue = source[key];

    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      target[key] = targetValue.concat(sourceValue);
    } else if (isObject(targetValue) && isObject(sourceValue)) {
      target[key] = mergeDeep(Object.assign({}, targetValue), sourceValue);
    } else {
      target[key] = sourceValue;
    }
  });

  return target;
}

export function computeName(
  index: number,
  series: ChartCardSeriesExternalConfig[] | undefined,
  entities: (HassEntity | undefined)[] | HassEntities | undefined = undefined,
  entity: HassEntity | undefined = undefined,
): string {
  if (!series || (!entities && !entity)) return '';
  let name = '';
  if (entity) {
    name = series[index].name || entity.attributes?.friendly_name || entity.entity_id || '';
  } else if (entities) {
    name = series[index].name || entities[index]?.attributes?.friendly_name || entities[index]?.entity_id || '';
  }
  return name + (series[index].show?.offset_in_name && series[index].offset ? ` (${series[index].offset})` : '');
}

export function computeUom(
  index: number,
  series: ChartCardSeriesExternalConfig[] | undefined,
  entities: HassEntity[] | undefined[] | undefined = undefined,
  entity: HassEntity | undefined = undefined,
): string {
  if (!series || (!entities && !entity)) return '';
  if (entity) {
    return series[index].unit || entity.attributes?.unit_of_measurement || '';
  } else if (entities) {
    return series[index].unit || entities[index]?.attributes?.unit_of_measurement || '';
  }
  return '';
}

export function computeColors(colors: string[] | undefined): string[] {
  if (!colors) return [];
  return colors.map((color) => {
    return computeColor(color);
  });
}

export function computeColor(color: string): string {
  if (color[0] === '#') {
    return new TinyColor(color).toHexString();
  } else if (color.substring(0, 3) === 'var') {
    return new TinyColor(
      window.getComputedStyle(document.documentElement).getPropertyValue(color.substring(4).slice(0, -1)).trim(),
    ).toHexString();
  } else {
    return new TinyColor(color).toHexString();
  }
}

export function computeTextColor(backgroundColor: string): string {
  const colorObj = new TinyColor(backgroundColor);
  if (colorObj.isValid && colorObj.getLuminance() > 0.5) {
    return '#000'; // bright colors - black font
  } else {
    return '#fff'; // dark colors - white font
  }
}

export function validateInterval(interval: string, prefix: string): number {
  const parsed = parse(interval);
  if (parsed === null || parsed === undefined) {
    throw new Error(`'${prefix}: ${interval}' is not a valid range of time`);
  }
  return parsed;
}

export function validateOffset(interval: string, prefix: string): number {
  if (interval[0] !== '+' && interval[0] !== '-') {
    throw new Error(`'${prefix}: ${interval}' should start with a '+' or a '-'`);
  }
  return validateInterval(interval, prefix);
}

export function offsetData(data: EntityCachePoints, offset: number | undefined): EntityCachePoints {
  if (offset) {
    return data.map((entry) => {
      return [entry[0] - offset, entry[1]];
    });
  }
  return data;
}

const TIME_UNITS_INTL: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 31536000000 },
  { unit: 'day', ms: 86400000 },
  { unit: 'hour', ms: 3600000 },
  { unit: 'minute', ms: 60000 },
  { unit: 'second', ms: 1000 },
  // millisecond is not a standard Intl.RelativeTimeFormatUnit, handled separately
];

function formatDuration(ms: number): string {
  if (ms === 0) return '0ms';

  let remainingMs = Math.abs(ms);
  const parts: string[] = [];

  for (const { unit, ms: unitMs } of TIME_UNITS_INTL) {
    if (remainingMs >= unitMs) {
      const value = Math.floor(remainingMs / unitMs);
      // Use abbreviations consistent with moment's format (y, d, h, m, s)
      let abbr = unit.charAt(0); // y, d, h, m, s
      parts.push(`${value}${abbr}`);
      remainingMs %= unitMs;
    }
  }

  // Handle remaining milliseconds
  if (remainingMs >= 1) {
    // Show ms if >= 1ms
    parts.push(`${Math.round(remainingMs)}ms`);
  } else if (parts.length === 0 && Math.abs(ms) > 0) {
    // If the original value was < 1ms but > 0ms, show it rounded
    // Use original ms here as remainingMs might be 0 after division
    parts.push(`${Math.round(Math.abs(ms))}ms`);
  }

  // If after all calculations, parts is empty (e.g., input was 0.1ms), return 0ms
  if (parts.length === 0) {
    return '0ms';
  }

  return (ms < 0 ? '-' : '') + parts.join(' ');
}

export function prettyPrintTime(value: string | number | null, unit: ChartCardPrettyTime): string {
  if (value === null || value === undefined) return NO_VALUE;

  let ms: number;
  if (typeof value === 'string') {
    // Try parsing if it's a string that might represent a number
    ms = parseFloat(value);
    if (isNaN(ms)) return NO_VALUE; // Or handle potential duration strings if needed
  } else {
    ms = value;
  }

  // Convert input value to milliseconds based on the unit
  switch (unit) {
    case 'millisecond':
      // value is already in ms
      break;
    case 'second':
      ms *= 1000;
      break;
    case 'minute':
      ms *= 60000;
      break;
    case 'hour':
      ms *= 3600000;
      break;
    case 'day':
      ms *= 86400000;
      break;
    case 'week':
      ms *= 604800000;
      break;
    case 'month':
      ms *= (365.25 / 12) * 86400000;
      break;
    case 'year':
      ms *= 365.25 * 86400000;
      break;
    default:
      // Assume milliseconds if unit is unknown or not provided
      break;
  }

  return formatDuration(ms);
}

export function getPercentFromValue(value: number, min: number | undefined, max: number | undefined): number {
  const lMin = min === undefined ? DEFAULT_MIN : min;
  const lMax = max === undefined ? DEFAULT_MAX : max;
  return ((value - lMin) * 100) / (lMax - lMin);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getLovelace(): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let root: any = document.querySelector('home-assistant');
  root = root && root.shadowRoot;
  root = root && root.querySelector('home-assistant-main');
  root = root && root.shadowRoot;
  root = root && root.querySelector('app-drawer-layout partial-panel-resolver, ha-drawer partial-panel-resolver');
  root = (root && root.shadowRoot) || root;
  root = root && root.querySelector('ha-panel-lovelace');
  root = root && root.shadowRoot;
  root = root && root.querySelector('hui-root');
  if (root) {
    const ll = root.lovelace;
    ll.current_view = root.___curView;
    return ll;
  }
  return null;
}

export function interpolateColor(a: string, b: string, factor: number): string {
  const ah = +a.replace('#', '0x');
  const ar = ah >> 16;
  const ag = (ah >> 8) & 0xff;
  const ab = ah & 0xff;
  const bh = +b.replace('#', '0x');
  const br = bh >> 16;
  const bg = (bh >> 8) & 0xff;
  const bb = bh & 0xff;
  const rr = ar + factor * (br - ar);
  const rg = ag + factor * (bg - ag);
  const rb = ab + factor * (bb - ab);

  return `#${(((1 << 24) + (rr << 16) + (rg << 8) + rb) | 0).toString(16).slice(1)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export function mergeConfigTemplates(ll: any, config: ChartCardExternalConfig): ChartCardExternalConfig {
  const tpl = config.config_templates;
  if (!tpl) return config;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any = {};
  const tpls = tpl && Array.isArray(tpl) ? tpl : [tpl];
  tpls?.forEach((template) => {
    if (!ll.config.apexcharts_card_templates?.[template])
      throw new Error(`apexcharts-card template '${template}' is missing from your config!`);
    const res = mergeConfigTemplates(ll, JSON.parse(JSON.stringify(ll.config.apexcharts_card_templates[template])));
    result = mergeDeepConfig(result, res);
  });
  result = mergeDeepConfig(result, config);
  return result as ChartCardExternalConfig;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export function mergeDeepConfig(target: any, source: any): any {
  const isObject = (obj) => obj && typeof obj === 'object';

  if (!isObject(target) || !isObject(source)) {
    return source;
  }

  Object.keys(source).forEach((key) => {
    const targetValue = target[key];
    const sourceValue = source[key];

    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      target[key] = mergeDeepConfig(targetValue, sourceValue);
    } else if (isObject(targetValue) && isObject(sourceValue)) {
      target[key] = mergeDeepConfig(Object.assign({}, targetValue), sourceValue);
    } else {
      target[key] = sourceValue;
    }
  });

  return target;
}

export function is12HourFromLocale(locale: string): boolean {
  try {
    // Check timeStyle short format for AM/PM marker
    const formattedTime = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(
      new Date(2000, 0, 1, 13, 0, 0),
    );
    // A simple check, might need refinement for specific locales
    return /am|pm/i.test(formattedTime);
  } catch (e) {
    // Fallback if Intl fails for the locale
    return false;
  }
}

export function is12Hour(config: ChartCardConfig | undefined, hass: HomeAssistant | undefined): boolean {
  const lang = getLang(config, hass);
  const locale = (hass?.locale as OverrideFrontendLocaleData)?.time_format;

  if (config?.hours_12 !== undefined) {
    return config.hours_12;
  } else if (locale === '12') {
    return true;
  } else if (locale === '24') {
    return false;
  } else {
    return is12HourFromLocale(lang);
  }
}

export function formatApexDate(
  config: ChartCardConfig,
  hass: HomeAssistant | undefined,
  value: Date,
  withDate = true,
): string {
  const lang = getLang(config, hass);
  const use12Hour = is12Hour(config, hass);
  const now = new Date();
  const currentYear = now.getFullYear();
  const dateYear = value.getFullYear();

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: use12Hour,
  };

  const dateOptions: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    // Only show year if different from current year
    year: dateYear !== currentYear ? 'numeric' : undefined,
  };

  try {
    const formatter = new Intl.DateTimeFormat(lang, withDate ? { ...dateOptions, ...timeOptions } : timeOptions);
    return formatter.format(value);
  } catch (e) {
    log(`Error formatting date for locale ${lang}: ${e}`);
    // Fallback to default locale if provided lang fails
    try {
      const fallbackFormatter = new Intl.DateTimeFormat(
        undefined,
        withDate ? { ...dateOptions, ...timeOptions } : timeOptions,
      );
      return fallbackFormatter.format(value);
    } catch (fallbackErr) {
      // Final fallback to basic ISO string part if everything fails
      return value.toISOString();
    }
  }
}

export function getLang(config: ChartCardConfig | undefined, hass: HomeAssistant | undefined): string {
  return config?.locale || hass?.language || 'en';
}

export function truncateFloat(
  value: string | number | null | undefined,
  precision: number | undefined,
): string | number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  let numValue: number;

  if (typeof value === 'string') {
    numValue = parseFloat(value);
    if (Number.isNaN(numValue)) {
      return value;
    }
  } else {
    numValue = value;
  }

  if (Number.isInteger(numValue)) {
    return numValue;
  }

  const p = precision === undefined ? DEFAULT_FLOAT_PRECISION : precision;
  const factor = Math.pow(10, p);
  const truncatedValue = Math.floor(numValue * factor) / factor;

  return truncatedValue;
}

export function myFormatNumber(
  num: string | number | null | undefined,
  localeOptions?: FrontendLocaleData,
  precision?: number | undefined,
): string | null {
  let lValue: string | number | null | undefined = num;
  if (lValue === undefined || lValue === null) return null;
  if (typeof lValue === 'string') {
    lValue = parseFloat(lValue);
    if (Number.isNaN(lValue)) {
      return num as string;
    }
  }
  return formatNumber(lValue, localeOptions, {
    maximumFractionDigits: precision === undefined ? DEFAULT_FLOAT_PRECISION : precision,
  });
}

export function computeTimezoneDiffWithLocal(timezone: string | undefined): number {
  if (!timezone) return 0;
  // Replace moment-timezone logic with native Intl API if feasible for offset calculation
  // This is complex due to historical changes and DST.
  // For simplicity, we might keep the current logic or explore libraries like date-fns-tz
  // For now, returning 0 as a placeholder, acknowledging this needs a proper replacement.
  // Original logic (requires moment-timezone):
  // const serverTime = moment().tz(timezone);
  // const localTime = moment();
  // return serverTime.utcOffset() * 60 * 1000 - localTime.utcOffset() * 60 * 1000;

  // Basic native attempt (might be inaccurate due to DST/historical differences):
  try {
    const now = new Date();
    // Get offset string like GMT+X or GMT-X using Intl API
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, timeZoneName: 'longOffset' }); // Use 'en-GB' or similar stable locale instead of 'en-GB'
    const parts = formatter.formatToParts(now);
    const offsetString = parts.find((part) => part.type === 'timeZoneName')?.value; // e.g., GMT+01:00

    if (offsetString) {
      const match = offsetString.match(/GMT([+-])(\d{1,2}):(\d{2})/);
      if (match) {
        const sign = match[1] === '+' ? 1 : -1;
        const hours = parseInt(match[2], 10);
        const minutes = parseInt(match[3], 10);
        const serverOffsetMs = sign * (hours * 3600000 + minutes * 60000);
        const localOffsetMs = -now.getTimezoneOffset() * 60000; // getTimezoneOffset is opposite sign
        return serverOffsetMs - localOffsetMs;
      }
    }
    log(`Could not parse offset string: ${offsetString} for timezone ${timezone}`);
  } catch (e) {
    log(`Failed to calculate timezone offset for ${timezone}: ${e}`);
  }
  // Fallback to 0 if calculation fails
  return 0;
}

export function isUsingServerTimezone(/*config: ChartCardConfig, */ hass: HomeAssistant | undefined): boolean {
  return (hass?.locale as OverrideFrontendLocaleData).time_zone === 'server';
}
