import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import GraphEntry from '../graphEntry';
import { ChartCardSeriesConfig, EntityEntryCache, HassHistory, Statistics } from '../types';
import { ChartCardSpanExtConfig } from '../types-config';
import { HomeAssistant } from 'custom-card-helpers';
import { HassEntity } from 'home-assistant-js-websocket';

// Mock localforage
const mockLocalForageStore: Record<string, string | EntityEntryCache> = {};
jest.mock('localforage', () => ({
  config: jest.fn(),
  getItem: jest.fn((key: string) => Promise.resolve(mockLocalForageStore[key] || null)),
  setItem: jest.fn((key: string, value: string | EntityEntryCache) => {
    mockLocalForageStore[key] = value;
    return Promise.resolve(value);
  }),
  removeItem: jest.fn((key: string) => {
    delete mockLocalForageStore[key];
    return Promise.resolve();
  }),
  clear: jest.fn(() => {
    Object.keys(mockLocalForageStore).forEach((key) => delete mockLocalForageStore[key]);
    return Promise.resolve();
  }),
  iterate: jest.fn(() => Promise.resolve()), // Mock iterate if needed later
}));

// Mock utility functions if necessary (e.g., log)
jest.mock('../utils', () => {
  const actualUtils = jest.requireActual('../utils') as typeof import('../utils');
  return {
    ...Object.assign({}, actualUtils), // Keep the real utils
    log: jest.fn(), // Mock only the log function
    decompress: jest.fn((data) => actualUtils.decompress(data)), // Keep real function but make it spy-able
    compress: jest.fn((data) => actualUtils.compress(data)), // Keep real function but make it spy-able
  };
});

// Mock moment-range (should already be handled by graphEntry.ts itself, but ensure jest knows)
// No explicit mock needed here usually if the source file handles the extendMoment call.

describe('GraphEntry', () => {
  let graphEntry: GraphEntry;
  let mockHass: HomeAssistant;
  let minimalSeriesConfig: ChartCardSeriesConfig;
  let minimalSpanConfig: ChartCardSpanExtConfig | undefined;

  // --- Test Setup and Configuration ---
  beforeEach(() => {
    // Reset mocks and store before each test
    jest.clearAllMocks();
    Object.keys(mockLocalForageStore).forEach((key) => delete mockLocalForageStore[key]);

    minimalSeriesConfig = {
      entity: 'sensor.test_entity',
      index: 0,
      group_by: { duration: '1h', func: 'avg', fill: 'last' },
      show: {
        in_chart: true,
        legend_value: true,
        in_header: false,
        name_in_header: true,
        offset_in_name: false,
      },
      ignore_history: false,
    } as ChartCardSeriesConfig;

    minimalSpanConfig = undefined; // Or an example configuration

    // Create a minimal mockHass instance
    mockHass = {
      states: {
        'sensor.test_entity': {
          entity_id: 'sensor.test_entity',
          state: '10',
          attributes: { unit_of_measurement: '°C' },
          last_changed: new Date().toISOString(),
          last_updated: new Date().toISOString(),
          context: { id: '', parent_id: null, user_id: null },
        } as HassEntity,
      },
      callApi: jest.fn(),
    } as unknown as HomeAssistant;

    // Create a GraphEntry instance for tests
    graphEntry = new GraphEntry(0, 24 * 60 * 60 * 1000, true, minimalSeriesConfig, minimalSpanConfig);
    graphEntry.hass = mockHass;

    // Set start/end times according to the data for min/max tests
    (graphEntry as unknown as { _realStart: Date; _useCompress: boolean })._realStart = new Date(1000);
    (graphEntry as unknown as { _realStart: Date; _useCompress: boolean })._useCompress = false;
  });

  // --- Basic Initialization Tests ---
  describe('Initialization', () => {
    it('should initialize with correct default values', () => {
      expect(graphEntry).toBeDefined();
      expect(graphEntry.index).toBe(0);
      expect(graphEntry.history).toEqual([]);
      expect(graphEntry.lastState).toBeNull();
      expect(graphEntry.min).toBeUndefined();
      expect(graphEntry.max).toBeUndefined();
      expect(graphEntry.start).toBeInstanceOf(Date);
      expect(graphEntry.end).toBeInstanceOf(Date);
    });
  });

  // --- Data Access and Manipulation Tests ---
  describe('Data Management', () => {
    describe('Getter Methods', () => {
      const historyData: [number, number | null][] = [
        [1000, 10],
        [2000, 20],
        [3000, 15],
        [4000, null], // Test with null values
        [5000, 25],
      ];

      beforeEach(() => {
        // Set mock history data directly (to bypass _updateHistory etc.)
        (graphEntry as unknown as { _computedHistory: [number, number | null][] })._computedHistory = historyData;
        // Set start/end times according to the data for min/max tests
        (graphEntry as unknown as { _realStart: Date; _realEnd: Date })._realStart = new Date(1000);
        (graphEntry as unknown as { _realStart: Date; _realEnd: Date })._realEnd = new Date(5000);
      });

      it('should return the history array', () => {
        expect(graphEntry.history).toEqual(historyData);
      });

      it('should return the last state', () => {
        expect(graphEntry.lastState).toBe(25);
      });

      it('should return the minimum value', () => {
        expect(graphEntry.min).toBe(10);
      });

      it('should return the maximum value', () => {
        expect(graphEntry.max).toBe(25);
      });

      it('should return null lastState for empty history', () => {
        (graphEntry as unknown as { _computedHistory: [number, number | null][] })._computedHistory = [];
        expect(graphEntry.lastState).toBeNull();
      });

      it('should return undefined min/max for empty history', () => {
        (graphEntry as unknown as { _computedHistory: [number, number | null][] })._computedHistory = [];
        expect(graphEntry.min).toBeUndefined();
        expect(graphEntry.max).toBeUndefined();
      });
    });

    describe('Cache Management', () => {
      let entityID: string;
      let md5Config: string;
      let cacheKeyBase: string;
      const testCacheData: EntityEntryCache = {
        span: 24 * 60 * 60 * 1000,
        card_version: 'test-version',
        last_fetched: new Date(),
        data: [[1000, 10]],
      };

      beforeEach(() => {
        entityID = minimalSeriesConfig.entity;
        md5Config = (graphEntry as any)._md5Config;
        cacheKeyBase = `${entityID}_${md5Config}`;
        // Make sure the cache is empty
        jest.clearAllMocks();
        Object.keys(mockLocalForageStore).forEach((key) => delete mockLocalForageStore[key]);
      });

      it('should return undefined from _getCache for non-existent key', async () => {
        const result = await (
          graphEntry as unknown as {
            _getCache: (entityId: string, compressed: boolean) => Promise<EntityEntryCache | undefined>;
          }
        )._getCache(entityID, false);
        expect(result).toBeUndefined();
      });

      it('should correctly retrieve uncompressed data with _getCache', async () => {
        const cacheKey = `${cacheKeyBase}-raw`;
        mockLocalForageStore[cacheKey] = testCacheData; // Set data directly in the mock store

        const result = await (
          graphEntry as unknown as {
            _getCache: (entityId: string, compressed: boolean) => Promise<EntityEntryCache | undefined>;
          }
        )._getCache(entityID, false);
        expect(result).toEqual(testCacheData);
        // Since decompress is not mocked, we cannot call it
      });

      it('should correctly store uncompressed data with _setCache', async () => {
        const cacheKey = `${cacheKeyBase}-raw`;
        await (
          graphEntry as unknown as {
            _setCache: (entityId: string, data: EntityEntryCache, compressed: boolean) => Promise<void>;
          }
        )._setCache(entityID, testCacheData, false);

        expect(mockLocalForageStore[cacheKey]).toEqual(testCacheData);
        // Since compress is not mocked, we cannot call it
      });
    });
  });

  // --- History Update Process Tests ---
  describe('History Updates', () => {
    let startDate: Date;
    let endDate: Date;

    beforeEach(() => {
      startDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      endDate = new Date();
      // Make sure the history is empty
      (graphEntry as unknown as { _computedHistory: [number, number | null][] | undefined })._computedHistory =
        undefined;
    });

    describe('Basic Update Functionality', () => {
      it('should use current state when ignore_history is true', async () => {
        const configWithIgnore: ChartCardSeriesConfig = {
          ...minimalSeriesConfig,
          ignore_history: true,
        };
        graphEntry = new GraphEntry(0, 24 * 60 * 60 * 1000, true, configWithIgnore, minimalSpanConfig);
        graphEntry.hass = mockHass;

        const updated = await (
          graphEntry as unknown as { _updateHistory: (start: Date, end: Date) => Promise<boolean> }
        )._updateHistory(startDate, endDate);

        expect(updated).toBe(true);
        expect(graphEntry.history).toHaveLength(1);
        // Timestamp should be roughly now (from mockHass.states)
        expect(graphEntry.history[0][0]).toBeCloseTo(
          new Date(mockHass.states['sensor.test_entity'].last_updated).getTime(),
          -2,
        );
        expect(graphEntry.history[0][1]).toBe(10); // State from mockHass
        expect(mockHass.callApi).not.toHaveBeenCalled();
        expect((graphEntry as unknown as { _updating: boolean })._updating).toBe(false);
      });

      it('should use attribute value when ignore_history and attribute are set', async () => {
        const attributeName = 'power';
        const attributeValue = 55.5;
        const configWithAttribute: ChartCardSeriesConfig = {
          ...minimalSeriesConfig,
          ignore_history: true,
          attribute: attributeName,
        };
        mockHass.states['sensor.test_entity'].attributes[attributeName] = attributeValue;
        graphEntry = new GraphEntry(0, 24 * 60 * 60 * 1000, true, configWithAttribute, minimalSpanConfig);
        graphEntry.hass = mockHass;

        const updated = await (graphEntry as any)._updateHistory(startDate, endDate);

        expect(updated).toBe(true);
        expect(graphEntry.history).toHaveLength(1);
        expect(graphEntry.history[0][0]).toBeCloseTo(
          new Date(mockHass.states['sensor.test_entity'].last_updated).getTime(),
          -2,
        );
        expect(graphEntry.history[0][1]).toBe(attributeValue);
        expect(mockHass.callApi).not.toHaveBeenCalled();
        expect((graphEntry as any)._updating).toBe(false);
      });

      it('should return false and not update if already updating', async () => {
        (graphEntry as unknown as { _updating: boolean })._updating = true; // Set updating to true
        const updated = await (
          graphEntry as unknown as { _updateHistory: (start: Date, end: Date) => Promise<boolean> }
        )._updateHistory(startDate, endDate);
        expect(updated).toBe(false);
        expect(graphEntry.history).toEqual([]);
        expect(mockHass.callApi).not.toHaveBeenCalled();
      });

      it('should return false and not update if entity state is missing', async () => {
        graphEntry.hass = { ...mockHass, states: {} }; // Remove Entity State
        const updated = await (graphEntry as any)._updateHistory(startDate, endDate);
        expect(updated).toBe(false);
        expect(graphEntry.history).toEqual([]);
        expect(mockHass.callApi).not.toHaveBeenCalled();
      });
    });

    describe('Data Retrieval', () => {
      describe('History API', () => {
        it('should fetch history via callApi when no cache exists', async () => {
          const mockApiHistory: HassHistory = [
            [
              {
                last_updated: new Date(startDate.getTime() + 10000).toISOString(),
                last_changed: new Date(startDate.getTime() + 10000).toISOString(),
                state: '15',
                attributes: { unit_of_measurement: '°C' },
              },
            ],
            [
              {
                last_updated: new Date(startDate.getTime() + 20000).toISOString(),
                last_changed: new Date(startDate.getTime() + 20000).toISOString(),
                state: '20',
                attributes: { unit_of_measurement: '°C' },
              },
            ],
            [
              {
                last_updated: new Date(endDate.getTime() - 10000).toISOString(),
                last_changed: new Date(endDate.getTime() - 10000).toISOString(),
                state: '25',
                attributes: { unit_of_measurement: '°C' },
              },
            ],
          ];

          // Mock callApi to return history
          (mockHass.callApi as jest.Mock).mockImplementation(async (path: any, params: any) => {
            if (path === 'history/history_during_period') {
              // Simple parameter check (could be more detailed)
              expect(params.entity_id).toBe(minimalSeriesConfig.entity);
              expect(params.end_time).toBeDefined();
              expect(params.start_time).toBeDefined();
              return mockApiHistory;
            }
            return {};
          });

          // Make sure the cache is empty (done in main beforeEach)
          // Make sure that ignore_history is false (default in minimalSeriesConfig)

          const updated = await (graphEntry as any)._updateHistory(startDate, endDate);

          expect(updated).toBe(true);
          expect(mockHass.callApi).toHaveBeenCalledWith(
            'history/history_during_period',
            expect.objectContaining({ entity_id: minimalSeriesConfig.entity }),
          );
          // Note: The exact structure depends on _processHistory and _finalizeHistory
          // Check if _setCache was called (with localforage mock)
          expect((jest.requireMock('localforage') as { setItem: jest.Mock }).setItem).toHaveBeenCalled();
        });
      });

      describe('Statistics API', () => {
        it('should fetch statistics via callApi when configured', async () => {
          const statConfig: ChartCardSeriesConfig = {
            ...minimalSeriesConfig,
            statistics: { period: 'hour', type: 'mean' },
            // Group_by will be ignored when statistics is used
          };
          const mockApiStatistics: Statistics = {
            [minimalSeriesConfig.entity]: [
              {
                statistic_id: minimalSeriesConfig.entity,
                start: new Date(startDate.getTime() + 3600000).toISOString(),
                end: '...',
                mean: 12.3,
                state: 0,
                change: 0,
                last_reset: null,
                max: 0,
                min: 0,
                sum: 0,
              },
              {
                statistic_id: minimalSeriesConfig.entity,
                start: new Date(endDate.getTime() - 3600000).toISOString(),
                end: '...',
                mean: 45.6,
                state: 0,
                change: 0,
                last_reset: null,
                max: 0,
                min: 0,
                sum: 0,
              },
            ],
          };
          (mockHass.callApi as any).mockResolvedValueOnce(mockApiStatistics);

          graphEntry = new GraphEntry(0, 24 * 60 * 60 * 1000, false, statConfig, minimalSpanConfig);
          graphEntry.hass = mockHass;

          const updated = await (graphEntry as any)._updateHistory(startDate, endDate);

          expect(updated).toBe(true);
          expect(mockHass.callApi).toHaveBeenCalledWith(
            'recorder/statistics_during_period',
            expect.objectContaining({
              statistic_ids: [minimalSeriesConfig.entity],
              period: 'hour',
              types: ['mean'], // Should be based on statistics type configuration
            }),
          );
          // Expect the processed statistics data
          const expectedStats = [
            [new Date(startDate.getTime() + 3600000).getTime(), 12.3],
            [new Date(endDate.getTime() - 3600000).getTime(), 45.6],
          ];
          expect(graphEntry.history).toEqual(expectedStats);
          expect(graphEntry.lastState).toBe(45.6);
          // Cache should not be used when Statistics
          expect((jest.requireMock('localforage') as { setItem: jest.Mock }).setItem).not.toHaveBeenCalled();
        });
      });
    });
  });
});
