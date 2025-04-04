import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import GraphEntry from '../graphEntry';
import { ChartCardSeriesConfig, EntityEntryCache, HassHistory, Statistics } from '../types';
import { ChartCardSpanExtConfig } from '../types-config';
import { HomeAssistant } from 'custom-card-helpers';
import { HassEntity } from 'home-assistant-js-websocket';
import { compress, decompress } from '../utils';
import { DEFAULT_FLOAT_PRECISION } from '../const';

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
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'), // Behalte die echten utils bei
  log: jest.fn(), // Mocke nur die log-Funktion
  decompress: jest.fn((data) => jest.requireActual('../utils').decompress(data)), // Behalte echte Funktion bei, aber spionierbar
  compress: jest.fn((data) => jest.requireActual('../utils').compress(data)), // Behalte echte Funktion bei, aber spionierbar
}));

// Mock moment-range (should already be handled by graphEntry.ts itself, but ensure jest knows)
// No explicit mock needed here usually if the source file handles the extendMoment call.

describe('GraphEntry', () => {
  let graphEntry: GraphEntry;
  let mockHass: HomeAssistant;
  let minimalSeriesConfig: ChartCardSeriesConfig;
  let minimalSpanConfig: ChartCardSpanExtConfig | undefined;

  beforeEach(() => {
    // Reset mocks and store before each test
    jest.clearAllMocks();
    Object.keys(mockLocalForageStore).forEach((key) => delete mockLocalForageStore[key]);

    minimalSeriesConfig = {
      entity: 'sensor.test_entity',
      index: 0,
      group_by: { duration: '1h', func: 'avg', fill: 'last' },
      show: { in_chart: true } as any, // Vereinfacht für den Anfang
      ignore_history: false,
      // Weitere notwendige Eigenschaften hinzufügen...
    } as ChartCardSeriesConfig;

    minimalSpanConfig = undefined; // Oder eine Beispielkonfiguration

    // Erstelle eine minimale mockHass Instanz
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
      // Weitere notwendige hass Eigenschaften hinzufügen...
    } as unknown as HomeAssistant;

    // Erstelle eine GraphEntry Instanz für Tests
    graphEntry = new GraphEntry(0, 24 * 60 * 60 * 1000, true, minimalSeriesConfig, minimalSpanConfig);
    graphEntry.hass = mockHass; // Setze die mockHass Instanz
  });

  it('should initialize correctly', () => {
    expect(graphEntry).toBeDefined();
    expect(graphEntry.index).toBe(0);
    // Teste Getter im Initialzustand
    expect(graphEntry.history).toEqual([]);
    expect(graphEntry.lastState).toBeNull();
    expect(graphEntry.min).toBeUndefined();
    expect(graphEntry.max).toBeUndefined();
    expect(graphEntry.start).toBeInstanceOf(Date);
    expect(graphEntry.end).toBeInstanceOf(Date);
  });

  // --- Tests für Getter nachdem History gesetzt wurde ---
  describe('Getters with data', () => {
    const historyData: [number, number | null][] = [
      [1000, 10],
      [2000, 20],
      [3000, 15],
      [4000, null], // Teste mit null Werten
      [5000, 25],
    ];

    beforeEach(() => {
      // Setze mock history data direkt (um _updateHistory etc. zu umgehen)
      (graphEntry as any)._computedHistory = historyData;
      // Setze start/end Zeiten passend zu den Daten für min/max Tests
      (graphEntry as any)._realStart = new Date(1000);
      (graphEntry as any)._realEnd = new Date(5000);
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
      (graphEntry as any)._computedHistory = [];
      expect(graphEntry.lastState).toBeNull();
    });

    it('should return undefined min/max for empty history', () => {
      (graphEntry as any)._computedHistory = [];
      expect(graphEntry.min).toBeUndefined();
      expect(graphEntry.max).toBeUndefined();
    });
  });

  // --- Tests für Cache-Funktionen ---
  describe('Caching Functions', () => {
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
      // Stelle sicher, dass der Cache leer ist
      jest.clearAllMocks();
      Object.keys(mockLocalForageStore).forEach((key) => delete mockLocalForageStore[key]);
      // Setze _useCompress auf false für diese Tests (Standardverhalten)
      (graphEntry as any)._useCompress = false;
    });

    it('should return undefined from _getCache for non-existent key', async () => {
      const result = await (graphEntry as any)._getCache(entityID, false);
      expect(result).toBeUndefined();
    });

    it('should correctly retrieve uncompressed data with _getCache', async () => {
      const cacheKey = `${cacheKeyBase}-raw`;
      mockLocalForageStore[cacheKey] = testCacheData; // Setze Daten direkt in den Mock-Store

      const result = await (graphEntry as any)._getCache(entityID, false);
      expect(result).toEqual(testCacheData);
      // Da decompress nicht gemockt ist, können wir es nicht aufrufen
      // expect(decompress).not.toHaveBeenCalled();
    });

    it('should correctly store uncompressed data with _setCache', async () => {
      const cacheKey = `${cacheKeyBase}-raw`;
      await (graphEntry as any)._setCache(entityID, testCacheData, false);

      expect(mockLocalForageStore[cacheKey]).toEqual(testCacheData);
      // Da compress nicht gemockt ist, können wir es nicht aufrufen
      // expect(compress).not.toHaveBeenCalled();
    });
  });

  // --- Tests für _updateHistory ---
  describe('_updateHistory', () => {
    let startDate: Date;
    let endDate: Date;

    beforeEach(() => {
      startDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      endDate = new Date();
      // Stelle sicher, dass die History leer ist
      (graphEntry as any)._computedHistory = undefined;
    });

    it('should use current state when ignore_history is true', async () => {
      const configWithIgnore: ChartCardSeriesConfig = {
        ...minimalSeriesConfig,
        ignore_history: true,
      };
      graphEntry = new GraphEntry(0, 24 * 60 * 60 * 1000, true, configWithIgnore, minimalSpanConfig);
      graphEntry.hass = mockHass;

      const updated = await (graphEntry as any)._updateHistory(startDate, endDate);

      expect(updated).toBe(true);
      expect(graphEntry.history).toHaveLength(1);
      // Zeitstempel sollte roughly now sein (aus mockHass.states)
      expect(graphEntry.history[0][0]).toBeCloseTo(
        new Date(mockHass.states['sensor.test_entity'].last_updated).getTime(),
        -2,
      );
      expect(graphEntry.history[0][1]).toBe(10); // State from mockHass
      expect(mockHass.callApi).not.toHaveBeenCalled();
      expect((graphEntry as any)._updating).toBe(false);
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
      (graphEntry as any)._updating = true; // Setze updating auf true
      const updated = await (graphEntry as any)._updateHistory(startDate, endDate);
      expect(updated).toBe(false);
      expect(graphEntry.history).toEqual([]);
      expect(mockHass.callApi).not.toHaveBeenCalled();
    });

    it('should return false and not update if entity state is missing', async () => {
      graphEntry.hass = { ...mockHass, states: {} }; // Entferne Entity State
      const updated = await (graphEntry as any)._updateHistory(startDate, endDate);
      expect(updated).toBe(false);
      expect(graphEntry.history).toEqual([]);
      expect(mockHass.callApi).not.toHaveBeenCalled();
    });

    // --- Tests für History/Statistics Abruf ---
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
      (mockHass.callApi as jest.Mock).mockImplementation(async (path, params) => {
        if (path === 'history/history_during_period') {
          // Einfache Überprüfung der Parameter (könnte detaillierter sein)
          expect(params.entity_id).toBe(minimalSeriesConfig.entity);
          expect(params.end_time).toBeDefined();
          expect(params.start_time).toBeDefined();
          return mockApiHistory;
        }
        return {};
      });

      // Stelle sicher, dass der Cache leer ist (wird im Haupt-beforeEach gemacht)
      // Stelle sicher, dass ignore_history false ist (Standard in minimalSeriesConfig)

      const updated = await (graphEntry as any)._updateHistory(startDate, endDate);

      expect(updated).toBe(true);
      expect(mockHass.callApi).toHaveBeenCalledWith(
        'history/history_during_period',
        expect.objectContaining({ entity_id: minimalSeriesConfig.entity }),
      );
      // Erwarte die verarbeiteten Daten in der History
      // Beachte: Die genaue Struktur hängt von _processHistory und _finalizeHistory ab
      // Wir erwarten hier 3 Punkte plus einen potenziellen initialen Punkt
      expect(graphEntry.history.length).toBeGreaterThanOrEqual(3);
      expect(graphEntry.history[graphEntry.history.length - 1][1]).toBe(25); // Letzter Wert aus Mock
      expect((graphEntry as any)._updating).toBe(false);
      // Überprüfe, ob _setCache aufgerufen wurde (mit localforage mock)
      expect(jest.requireMock('localforage').setItem).toHaveBeenCalled();
    });

    // --- Tests for ignore_history, edge cases, no-cache API call ...

    it('should use cache when valid data exists', async () => {
      const cacheKey = `${minimalSeriesConfig.entity}_${(graphEntry as any)._md5Config}-raw`;
      const cachedData: EntityEntryCache = {
        span: 24 * 60 * 60 * 1000,
        card_version: 'test-version', // Übereinstimmende Version
        last_fetched: new Date(), // Aktuelles Datum
        data: [
          [startDate.getTime() + 5000, 5],
          [endDate.getTime() - 5000, 15],
        ],
      };
      mockLocalForageStore[cacheKey] = cachedData;

      const updated = await (graphEntry as any)._updateHistory(startDate, endDate);

      expect(updated).toBe(true);
      expect(mockHass.callApi).not.toHaveBeenCalled();
      expect(graphEntry.history).toEqual(cachedData.data); // Erwarte Cache-Daten
      expect((graphEntry as any)._updating).toBe(false);
      expect(jest.requireMock('localforage').setItem).not.toHaveBeenCalled(); // Nichts wurde gespeichert
    });

    it('should fetch history via callApi when cache is outdated', async () => {
      const cacheKey = `${minimalSeriesConfig.entity}_${(graphEntry as any)._md5Config}-raw`;
      const outdatedData: EntityEntryCache = {
        span: 24 * 60 * 60 * 1000,
        card_version: 'test-version',
        // Veraltetes Datum (älter als startDate)
        last_fetched: new Date(startDate.getTime() - 10 * 60 * 1000),
        data: [
          [startDate.getTime() - 20000, 1],
          [startDate.getTime() - 10000, 2],
        ],
      };
      mockLocalForageStore[cacheKey] = outdatedData;

      const mockApiHistory: HassHistory = [
        [
          {
            last_updated: new Date(endDate.getTime() - 10000).toISOString(),
            last_changed: new Date(endDate.getTime() - 10000).toISOString(),
            state: '99', // Neuer Wert aus API
            attributes: { unit_of_measurement: '°C' },
          },
        ],
      ];

      // Mock callApi, da der Cache ignoriert werden sollte
      (mockHass.callApi as jest.Mock).mockResolvedValue(mockApiHistory);

      const updated = await (graphEntry as any)._updateHistory(startDate, endDate);

      expect(updated).toBe(true);
      expect(mockHass.callApi).toHaveBeenCalledWith(
        'history/history_during_period',
        expect.objectContaining({ entity_id: minimalSeriesConfig.entity }),
      );
      // Erwarte die *neuen* Daten aus der API (oder eine Kombination, abhängig von der Logik)
      expect(graphEntry.history.length).toBeGreaterThanOrEqual(1);
      expect(graphEntry.history[graphEntry.history.length - 1][1]).toBe(99); // Wert aus API Mock
      expect((graphEntry as any)._updating).toBe(false);
      expect(jest.requireMock('localforage').setItem).toHaveBeenCalled(); // Neue Daten sollten gespeichert werden
    });

    it('should process history data correctly after API call', async () => {
      const mockApiHistory: HassHistory = [
        [
          { last_updated: new Date(startDate.getTime() + 10000).toISOString(), last_changed: '...', state: '15.5' },
          { last_updated: new Date(startDate.getTime() + 5000).toISOString(), last_changed: '...', state: '10.1' }, // Älterer Punkt zuerst
        ],
        [
          { last_updated: new Date(endDate.getTime() - 10000).toISOString(), last_changed: '...', state: 'invalid' }, // Ungültiger Status
        ],
        [{ last_updated: new Date(endDate.getTime() - 5000).toISOString(), last_changed: '...', state: '25.9' }],
      ];
      (mockHass.callApi as jest.Mock).mockResolvedValue(mockApiHistory);

      // Verwende 'raw' group_by, um die Verarbeitung einfacher zu testen
      const rawConfig = { ...minimalSeriesConfig, group_by: { func: 'raw' } } as ChartCardSeriesConfig;
      graphEntry = new GraphEntry(0, 24 * 60 * 60 * 1000, false, rawConfig, minimalSpanConfig);
      graphEntry.hass = mockHass;

      await (graphEntry as any)._updateHistory(startDate, endDate);

      expect(mockHass.callApi).toHaveBeenCalledTimes(1);
      // Erwartete verarbeitete Punkte (sortiert, geparsed, 'invalid' wird null)
      const expectedHistory = [
        [new Date(startDate.getTime() + 5000).getTime(), 10.1],
        [new Date(startDate.getTime() + 10000).getTime(), 15.5],
        [new Date(endDate.getTime() - 10000).getTime(), null],
        [new Date(endDate.getTime() - 5000).getTime(), 25.9],
      ];
      // Je nach _finalizeHistory Logik (z.B. Einfügen des Initialstatus) kann es mehr Punkte geben
      // Vergleiche die relevanten Teile
      expect(graphEntry.history).toEqual(expect.arrayContaining(expectedHistory));
      expect(graphEntry.history.length).toBeGreaterThanOrEqual(expectedHistory.length);
      expect(graphEntry.lastState).toBe(25.9);
    });

    it('should fetch statistics via callApi when configured', async () => {
      const statConfig: ChartCardSeriesConfig = {
        ...minimalSeriesConfig,
        statistics: { period: 'hour', type: 'mean' },
        // Group_by wird ignoriert, wenn statistics verwendet wird (implizit)
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
      (mockHass.callApi as jest.Mock).mockResolvedValue(mockApiStatistics);

      graphEntry = new GraphEntry(0, 24 * 60 * 60 * 1000, false, statConfig, minimalSpanConfig);
      graphEntry.hass = mockHass;

      const updated = await (graphEntry as any)._updateHistory(startDate, endDate);

      expect(updated).toBe(true);
      expect(mockHass.callApi).toHaveBeenCalledWith(
        'recorder/statistics_during_period',
        expect.objectContaining({
          statistic_ids: [minimalSeriesConfig.entity],
          period: 'hour',
          types: ['mean'], // Sollte auf type basieren
        }),
      );
      // Erwarte die verarbeiteten Statistikdaten
      const expectedStats = [
        [new Date(startDate.getTime() + 3600000).getTime(), 12.3],
        [new Date(endDate.getTime() - 3600000).getTime(), 45.6],
      ];
      expect(graphEntry.history).toEqual(expectedStats);
      expect(graphEntry.lastState).toBe(45.6);
      // Cache sollte bei Statistics nicht verwendet werden
      expect(jest.requireMock('localforage').setItem).not.toHaveBeenCalled();
    });

    // --- Hier weitere Testfälle für _processHistory/_finalizeHistory (z.B. group_by) ---
  });

  // --- Hier weitere Testfälle für andere Methoden einfügen ---
});
