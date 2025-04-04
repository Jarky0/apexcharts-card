import { jest, describe, it, expect } from '@jest/globals';
import {
  computeName,
  computeUom,
  validateInterval,
  validateOffset,
  prettyPrintTime,
  getPercentFromValue,
  interpolateColor,
  truncateFloat,
} from '../utils';
import { ChartCardSeriesExternalConfig, ChartCardPrettyTime } from '../types-config';
import { HassEntity } from 'home-assistant-js-websocket';

describe('Utility Functions', () => {
  describe('computeName', () => {
    const seriesConfig: ChartCardSeriesExternalConfig[] = [
      { entity: 'sensor.test1' },
      { entity: 'sensor.test2', name: 'My Sensor 2' },
      { entity: 'sensor.test3', offset: '+1d', show: { offset_in_name: true } },
      { entity: 'sensor.test4', offset: '+1d', show: { offset_in_name: false } },
    ];
    const entities: (HassEntity | undefined)[] = [
      { entity_id: 'sensor.test1', state: '10', attributes: { friendly_name: 'Friendly 1' } } as HassEntity,
      { entity_id: 'sensor.test2', state: '20', attributes: {} } as HassEntity,
      { entity_id: 'sensor.test3', state: '30', attributes: { friendly_name: 'Friendly 3' } } as HassEntity,
      { entity_id: 'sensor.test4', state: '40', attributes: {} } as HassEntity,
    ];

    it('should use friendly_name if name is not provided', () => {
      expect(computeName(0, seriesConfig, entities)).toBe('Friendly 1');
    });

    it('should use series name if provided', () => {
      expect(computeName(1, seriesConfig, entities)).toBe('My Sensor 2');
    });

    it('should use entity_id if no name or friendly_name', () => {
      const entitiesNoFriendly = [undefined, { entity_id: 'sensor.test2', state: '20', attributes: {} } as HassEntity];
      expect(computeName(1, seriesConfig, entitiesNoFriendly)).toBe('sensor.test2');
    });

    it('should append offset if show.offset_in_name is true', () => {
      expect(computeName(2, seriesConfig, entities)).toBe('Friendly 3 (+1d)');
    });

    it('should not append offset if show.offset_in_name is false or missing', () => {
      expect(computeName(3, seriesConfig, entities)).toBe('sensor.test4');
    });

    it('should return empty string if inputs are invalid', () => {
      expect(computeName(0, undefined, entities)).toBe('');
      expect(computeName(0, seriesConfig, undefined)).toBe('');
    });
  });

  describe('computeUom', () => {
    const seriesConfig: ChartCardSeriesExternalConfig[] = [
      { entity: 'sensor.test1' },
      { entity: 'sensor.test2', unit: '°F' },
    ];
    const entities: HassEntity[] = [
      { entity_id: 'sensor.test1', state: '10', attributes: { unit_of_measurement: '°C' } } as HassEntity,
      { entity_id: 'sensor.test2', state: '20', attributes: { unit_of_measurement: '°C' } } as HassEntity,
    ];

    it('should use entity unit_of_measurement if series unit is not provided', () => {
      expect(computeUom(0, seriesConfig, entities)).toBe('°C');
    });

    it('should use series unit if provided', () => {
      expect(computeUom(1, seriesConfig, entities)).toBe('°F');
    });

    it('should return empty string if no unit is found', () => {
      const entitiesNoUnit: HassEntity[] = [{ entity_id: 'sensor.test1', state: '10', attributes: {} } as HassEntity];
      expect(computeUom(0, [{ entity: 'sensor.test1' }], entitiesNoUnit)).toBe('');
    });
  });

  describe('validateInterval', () => {
    it('should parse valid intervals correctly', () => {
      expect(validateInterval('1h', 'test')).toBe(3600000);
      expect(validateInterval('30min', 'test')).toBe(1800000);
      expect(validateInterval('2d 5h', 'test')).toBe(190800000);
    });

    it('should throw an error for invalid intervals', () => {
      expect(() => validateInterval('invalid', 'test')).toThrow("'test: invalid' is not a valid range of time");
    });
  });

  describe('validateOffset', () => {
    it('should parse valid offsets correctly', () => {
      expect(validateOffset('+1h', 'test')).toBe(3600000);
      expect(validateOffset('-30min', 'test')).toBe(-1800000);
    });

    it('should throw an error if offset does not start with + or -', () => {
      expect(() => validateOffset('1h', 'test')).toThrow("'test: 1h' should start with a '+' or a '-'");
    });

    it('should throw an error for invalid offsets', () => {
      expect(() => validateOffset('+invalid', 'test')).toThrow("'test: +invalid' is not a valid range of time");
    });
  });

  describe('prettyPrintTime', () => {
    it('should format milliseconds correctly', () => {
      expect(prettyPrintTime(1234, 'milliseconds' as ChartCardPrettyTime)).toBe('1s 234ms');
    });
    it('should format seconds correctly', () => {
      expect(prettyPrintTime(123, 'seconds' as ChartCardPrettyTime)).toBe('2m 3s');
    });
    it('should format minutes correctly', () => {
      expect(prettyPrintTime(90, 'minutes' as ChartCardPrettyTime)).toBe('1h 30m');
    });
    it('should format hours correctly', () => {
      expect(prettyPrintTime(26, 'hours' as ChartCardPrettyTime)).toBe('1d 2h');
    });
    it('should format days correctly', () => {
      expect(prettyPrintTime(10, 'day' as ChartCardPrettyTime)).toBe('1w 3d');
    });
    it('should return NO_VALUE for null input', () => {
      expect(prettyPrintTime(null, 'seconds' as ChartCardPrettyTime)).toBe('--');
    });
  });

  describe('getPercentFromValue', () => {
    it('should calculate percentage correctly', () => {
      expect(getPercentFromValue(50, 0, 100)).toBe(50);
      expect(getPercentFromValue(0, 0, 100)).toBe(0);
      expect(getPercentFromValue(100, 0, 100)).toBe(100);
      expect(getPercentFromValue(25, 0, 50)).toBe(50);
    });
    it('should handle default min/max', () => {
      expect(getPercentFromValue(50, undefined, undefined)).toBe(50); // Default 0-100
    });
  });

  describe('interpolateColor', () => {
    it('should interpolate between two colors', () => {
      expect(interpolateColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
      expect(interpolateColor('#ff0000', '#0000ff', 1)).toBe('#0000ff');
      expect(interpolateColor('#ff0000', '#0000ff', 0.5)).toBe('#800080');
    });
  });

  describe('truncateFloat', () => {
    it('should truncate float to specified precision', () => {
      expect(truncateFloat(1.2345, 2)).toBe(1.23);
      expect(truncateFloat(1.2, 2)).toBe(1.2);
      expect(truncateFloat(1, 2)).toBe(1);
    });
    it('should handle default precision (2)', () => {
      expect(truncateFloat(1.23456, undefined)).toBe(1.23);
    });
    it('should handle precision 0', () => {
      expect(truncateFloat(1.9, 0)).toBe(1);
    });
    it('should return non-numbers as is', () => {
      expect(truncateFloat('abc', 2)).toBe('abc');
      expect(truncateFloat(null, 2)).toBe(null);
      expect(truncateFloat(undefined, 2)).toBe(undefined);
    });
  });
});
