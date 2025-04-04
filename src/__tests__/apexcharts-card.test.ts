import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../apexcharts-card'; // Importiere die Komponente, um sie zu registrieren
import { ApexChartsCard } from '../apexcharts-card'; // Importiere den Typ, falls exportiert, sonst any
import { HomeAssistant } from 'custom-card-helpers';
import { HassEntity } from 'home-assistant-js-websocket';
import { ChartCardExternalConfig } from '../types-config';

// --- Mocks ---

// Mock ApexCharts
const mockApexChartInstance = {
  render: jest.fn(() => Promise.resolve()),
  updateOptions: jest.fn(() => Promise.resolve()),
  destroy: jest.fn(),
  hideSeries: jest.fn(),
  // Füge weitere benötigte Methoden hinzu
};
jest.mock('apexcharts', () => {
  return jest.fn().mockImplementation(() => mockApexChartInstance);
});

// Mock GraphEntry - Erlaube das Setzen von mock history
const mockGraphEntryInstances: any[] = [];
jest.mock('../graphEntry', () => {
  return jest.fn().mockImplementation((index, graphSpan, cache, config, span) => {
    const instance = {
      hass: null,
      history: [], // Wird im Test überschrieben
      lastState: null,
      min: undefined,
      max: undefined,
      index: index,
      _updateHistory: jest.fn().mockImplementation(async () => {
        // Simuliere, dass _updateHistory die history-Property setzt
        instance.history = instance._mockHistoryData || [];
        instance.lastState = instance.history.length > 0 ? instance.history[instance.history.length - 1][1] : null;
        return true;
      }),
      // Füge eine Möglichkeit hinzu, Mock-Daten zu setzen
      _setMockHistoryData: (data: [number, number | null][]) => {
        instance._mockHistoryData = data;
      },
      _mockHistoryData: [], // Speicher für Mock-Daten
    };
    mockGraphEntryInstances[index] = instance;
    return instance;
  });
});

// Mock actionHandler directive
jest.mock('../action-handler-directive', () => ({
  actionHandler: jest.fn(),
}));

// Mock utils if needed (log is useful)
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  log: jest.fn(),
  getLovelace: jest.fn(() => ({ editMode: false })), // Mock editMode
  // Mocke weitere Utils bei Bedarf
}));

describe('ApexChartsCard Component', () => {
  let card: ApexChartsCard;
  let hass: HomeAssistant;
  let config: ChartCardExternalConfig;

  beforeEach(async () => {
    mockGraphEntryInstances.length = 0; // Leere Instanzen vor jedem Test
    // Reset mocks
    jest.clearAllMocks();

    // Erstelle eine minimale Hass-Instanz
    hass = {
      states: {
        'sensor.test': {
          entity_id: 'sensor.test',
          state: '123',
          attributes: { unit_of_measurement: '°C' },
          last_changed: new Date().toISOString(),
          last_updated: new Date().toISOString(),
          context: { id: '', parent_id: null, user_id: null },
        } as HassEntity,
      },
      config: {
        time_zone: 'UTC', // Wichtig für Zeitberechnungen
      },
      localize: jest.fn((key) => key), // Einfacher Localize Mock
      language: 'en',
      // Füge weitere benötigte hass Eigenschaften hinzu
    } as unknown as HomeAssistant;

    // Erstelle eine minimale Konfiguration
    config = {
      type: 'custom:apexcharts-card',
      series: [{ entity: 'sensor.test', name: 'Test Sensor' }],
    };

    // Erstelle das Element
    card = document.createElement('apexcharts-card') as ApexChartsCard;
    document.body.appendChild(card);

    // Setze Konfiguration und Hass
    card.setConfig(config);
    card.hass = hass;

    // Warte auf Updates nach setConfig/hass (Lit updated lifecycle)
    await card.updateComplete;
  });

  afterEach(() => {
    // Räume das Element nach jedem Test auf
    document.body.removeChild(card);
  });

  it('should be defined', () => {
    expect(card).toBeDefined();
    expect(customElements.get('apexcharts-card')).toBeDefined();
  });

  it('should render a ha-card element', () => {
    expect(card.shadowRoot?.querySelector('ha-card')).not.toBeNull();
  });

  it('should call ApexCharts constructor on initial load', () => {
    // Der Konstruktor wird während setConfig/initial render aufgerufen
    expect(jest.requireMock('apexcharts')).toHaveBeenCalled();
    expect(mockApexChartInstance.render).toHaveBeenCalled();
  });

  // --- Tests für hass Property ---
  describe('when hass property changes', () => {
    let initialHass: HomeAssistant;

    beforeEach(() => {
      initialHass = { ...hass }; // Kopiere initialen Hass-Zustand
    });

    it('should update GraphEntry hass and trigger update on entity state change', async () => {
      const graphEntryMock = mockGraphEntryInstances[0];
      expect(graphEntryMock.hass).toEqual(initialHass); // Prüfe initialen Hass

      const updatedStateValue = '456';
      const newHass = {
        ...initialHass,
        states: {
          ...initialHass.states,
          'sensor.test': {
            ...initialHass.states['sensor.test'],
            state: updatedStateValue,
            last_updated: new Date().toISOString(),
          } as HassEntity,
        },
      };

      card.hass = newHass;
      await card.updateComplete;

      // Gib Zeit für den setTimeout in der hass-Setter-Logik
      await new Promise((resolve) => setTimeout(resolve, (card as any)._updateDelay + 50));

      expect(graphEntryMock.hass).toEqual(newHass);
      expect(graphEntryMock._updateHistory).toHaveBeenCalled();
    });

    it("should update _headerState when show.in_header is 'raw'", async () => {
      // Passe die Konfiguration für diesen Test an
      const rawHeaderConfig: ChartCardExternalConfig = {
        ...config,
        series: [
          {
            ...config.series[0],
            show: { in_header: 'raw', in_chart: true }, // Setze in_header auf raw
          },
        ],
      };
      card.setConfig(rawHeaderConfig);
      card.hass = hass; // Setze initialen Hass erneut
      await card.updateComplete;

      const initialStateValue = parseFloat(hass.states['sensor.test'].state);
      expect((card as any)._headerState[0]).toBe(initialStateValue);

      const updatedStateValue = '789.123';
      const newHass = {
        ...hass,
        states: {
          ...hass.states,
          'sensor.test': {
            ...hass.states['sensor.test'],
            state: updatedStateValue,
            last_updated: new Date().toISOString(),
          } as HassEntity,
        },
      };

      card.hass = newHass;
      await card.updateComplete;

      // _headerState sollte mit dem neuen Rohwert aktualisiert werden
      // Beachte: Die Funktion verwendet truncateFloat intern, wir müssen das berücksichtigen
      // Annahme: Standard float_precision ist 2
      expect((card as any)._headerState[0]).toBe(789.12);
    });

    it('should NOT trigger update if entity state has not changed', async () => {
      const graphEntryMock = mockGraphEntryInstances[0];
      graphEntryMock._updateHistory.mockClear(); // Lösche vorherige Aufrufe

      // Setze Hass erneut mit demselben Zustand
      card.hass = { ...hass };
      await card.updateComplete;

      // Gib Zeit für den setTimeout
      await new Promise((resolve) => setTimeout(resolve, (card as any)._updateDelay + 50));

      expect(graphEntryMock._updateHistory).not.toHaveBeenCalled();
    });
  });

  // --- Test für ApexCharts Interaktion ---
  describe('ApexCharts Interaction', () => {
    it('should call updateOptions with correct data after data update', async () => {
      // Lösche vorherige Aufrufe an Mocks
      mockApexChartInstance.updateOptions.mockClear();
      const graphEntryMock = mockGraphEntryInstances[0];
      graphEntryMock._updateHistory.mockClear();

      // Definiere Mock-History-Daten, die von GraphEntry zurückgegeben werden sollen
      const mockHistory: [number, number | null][] = [
        [new Date(Date.now() - 10 * 60 * 1000).getTime(), 50],
        [new Date(Date.now() - 5 * 60 * 1000).getTime(), 60],
      ];
      graphEntryMock._setMockHistoryData(mockHistory);

      // Simuliere eine Hass-Änderung, die _updateHistory auslöst
      const newHass = {
        ...hass,
        states: {
          ...hass.states,
          'sensor.test': {
            ...hass.states['sensor.test'],
            state: '999',
            last_updated: new Date().toISOString(),
          } as HassEntity,
        },
      };

      card.hass = newHass;
      await card.updateComplete;

      // Gib Zeit für setTimeout und _updateHistory
      await new Promise((resolve) => setTimeout(resolve, (card as any)._updateDelay + 100));
      // Warte nicht mehr explizit auf _updateHistory, da es jetzt synchron im Test simuliert wird

      expect(mockApexChartInstance.updateOptions).toHaveBeenCalledTimes(1);

      const optionsPassed = mockApexChartInstance.updateOptions.mock.calls[0][0];
      expect(optionsPassed).toBeDefined();
      expect(optionsPassed.series).toBeDefined();
      expect(optionsPassed.series).toHaveLength(1);
      // Erwarte, dass die series-Daten den mockHistory entsprechen
      expect(optionsPassed.series[0].data).toEqual(mockHistory);
      expect(optionsPassed.xaxis).toBeDefined();
      expect(optionsPassed.xaxis.min).toBeDefined();
      expect(optionsPassed.xaxis.max).toBeDefined();
      // Überprüfe, ob der Zeitbereich plausibel ist (Start sollte etwa 24h vor Ende sein)
      expect(optionsPassed.xaxis.max - optionsPassed.xaxis.min).toBeCloseTo(24 * 60 * 60 * 1000, -5);
    });

    // Test für Brush Interaktion (falls brush aktiviert ist)
    it('should initialize ApexCharts brush if configured', async () => {
      const ApexChartsMock = jest.requireMock('apexcharts');
      ApexChartsMock.mockClear();
      mockApexChartInstance.render.mockClear();

      const brushConfig: ChartCardExternalConfig = {
        ...config,
        experimental: { brush: true },
        series: [{ entity: 'sensor.test', show: { in_chart: true, in_brush: true } }],
      };
      // Erstelle Karte neu mit Brush-Konfig
      document.body.removeChild(card);
      card = document.createElement('apexcharts-card') as ApexChartsCard;
      document.body.appendChild(card);
      card.setConfig(brushConfig);
      card.hass = hass;
      await card.updateComplete;

      // Es sollten ZWEI ApexCharts-Instanzen erstellt worden sein (Graph + Brush)
      expect(ApexChartsMock).toHaveBeenCalledTimes(2);
      expect(mockApexChartInstance.render).toHaveBeenCalledTimes(2);
    });
  });

  // --- Tests für setConfig ---
  describe('setConfig', () => {
    // ... Tests für defaults, all_series_config, GraphEntry, colors ...

    // --- Tests für Validierung ---
    it('should throw error for invalid graph_span', () => {
      const invalidConfig = { ...config, graph_span: 'invalid' };
      expect(() => card.setConfig(invalidConfig)).toThrow(/graph_span: invalid.*is not a valid range/);
    });

    it('should throw error for invalid update_interval', () => {
      const invalidConfig = { ...config, update_interval: 'invalid' };
      expect(() => card.setConfig(invalidConfig)).toThrow(/update_interval: invalid.*is not a valid range/);
    });

    it('should throw error for invalid offset', () => {
      const invalidConfig = { ...config, span: { offset: '1d' } }; // Missing +/- prefix
      expect(() => card.setConfig(invalidConfig)).toThrow(/span.offset: 1d.*should start with a/);
    });

    it('should throw error for invalid series offset', () => {
      const invalidConfig = {
        ...config,
        series: [{ ...config.series[0], offset: '1h' }], // Missing +/-
      };
      expect(() => card.setConfig(invalidConfig)).toThrow(/series\[0\].offset: 1h.*should start with a/);
    });

    it('should throw error for both span.start and span.end', () => {
      const invalidConfig = { ...config, span: { start: 'day', end: 'day' } };
      expect(() => card.setConfig(invalidConfig)).toThrow(/Only one of 'start' or 'end' is allowed/);
    });

    it('should throw error for missing yaxis_id with multiple yaxes', () => {
      const invalidConfig = {
        ...config,
        yaxis: [{ id: 'y1' }, { id: 'y2' }], // Multiple axes defined
        series: [{ entity: 'sensor.test' }], // Serie hat keine yaxis_id
      };
      expect(() => card.setConfig(invalidConfig)).toThrow(/missing the 'yaxis_id' configuration/);
    });

    it('should throw error for missing id in multiple yaxes', () => {
      const invalidConfig = {
        ...config,
        yaxis: [{}, { id: 'y2' }], // Eine Achse ohne id
        series: [{ entity: 'sensor.test', yaxis_id: 'y2' }],
      };
      expect(() => card.setConfig(invalidConfig)).toThrow(/missing an 'id'/);
    });

    it('should throw error for non-existent yaxis_id', () => {
      const invalidConfig = {
        ...config,
        yaxis: [{ id: 'y1' }],
        series: [{ entity: 'sensor.test', yaxis_id: 'nonexistent' }],
      };
      expect(() => card.setConfig(invalidConfig)).toThrow(/yaxis_id: nonexistent.*doesn't exist/);
    });
  });

  // --- Fügen Sie hier weitere Tests hinzu ---
});
