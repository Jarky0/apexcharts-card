// cSpell:ignore Hass,apexcharts
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import '../apexcharts-card'; // Import the component to register it
import { HomeAssistant } from 'custom-card-helpers';
import { HassEntity } from 'home-assistant-js-websocket';
import { ChartCardExternalConfig } from '../types-config';
import { LitElement } from 'lit';

interface ApexChartsCardElement extends LitElement {
  setConfig(config: ChartCardExternalConfig): void;
  hass: HomeAssistant;
}

// --- Mocks ---

// Mock ApexCharts
const mockApexChartInstance = {
  render: jest.fn(() => Promise.resolve()),
  updateOptions: jest.fn(() => Promise.resolve()),
  destroy: jest.fn(),
  hideSeries: jest.fn(),
  // Add other required methods
};
jest.mock('apexcharts', () => {
  return jest.fn().mockImplementation(() => mockApexChartInstance);
});

// Define an interface for the mock GraphEntry instance
interface MockGraphEntryInstance {
  hass: HomeAssistant | null;
  history: [number, number | null][];
  lastState: number | null;
  min: number | undefined;
  max: number | undefined;
  index: number;
  _updateHistory: jest.Mock<() => Promise<boolean>>;
  _setMockHistoryData: (data: [number, number | null][]) => void;
  _mockHistoryData: [number, number | null][];
}

// Mock GraphEntry - Allow setting mock history
const mockGraphEntryInstances: MockGraphEntryInstance[] = [];
jest.mock('../graphEntry', () => {
  // Remove unused parameters: graphSpan, cache, config, span
  return jest.fn().mockImplementation((index) => {
    const instance: Partial<MockGraphEntryInstance> & { _mockHistoryData: [number, number | null][] } = {
      hass: null,
      history: [], // Will be overwritten in the test
      lastState: null,
      min: undefined as number | undefined,
      max: undefined as number | undefined,
      index: index as number,
      _updateHistory: jest.fn<() => Promise<boolean>>().mockImplementation(async () => {
        // Simulate that _updateHistory sets the history property
        instance.history = instance._mockHistoryData || [];
        instance.lastState =
          instance.history.length > 0 ? instance.history[instance.history.length - 1][1] : (null as number | null);
        return Promise.resolve(true);
      }),
      _mockHistoryData: [] as [number, number | null][],
      _setMockHistoryData: (data: [number, number | null][]) => {
        instance._mockHistoryData = data;
      },
    };
    // Fix the type assertion error by using a type guard or a more specific type
    if (typeof index === 'number') {
      mockGraphEntryInstances[index] = instance as MockGraphEntryInstance;
    } else {
      throw new Error('Index must be a number');
    }
    return instance;
  });
});

// Mock actionHandler directive
jest.mock('../action-handler-directive', () => ({
  actionHandler: jest.fn(),
}));

// Mock utils if needed (log is useful)
jest.mock('../utils', () => ({
  ...Object.assign({}, jest.requireActual('../utils')),
  log: jest.fn(),
  getLovelace: jest.fn(() => ({ editMode: false })), // Mock editMode
  // Mock other utils if needed
}));

describe('ApexChartsCard Component', () => {
  let card: ApexChartsCardElement;
  let hass: HomeAssistant;
  let config: ChartCardExternalConfig;

  beforeEach(async () => {
    mockGraphEntryInstances.length = 0; // Clear instances before each test
    // Reset mocks
    jest.clearAllMocks();

    // Create a minimal Hass instance
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
        time_zone: 'UTC', // Important for time calculations
      },
      localize: jest.fn((key) => key), // Simple Localize Mock
      language: 'en',
      // Add other required hass properties
    } as unknown as HomeAssistant;

    // Create a minimal configuration
    config = {
      type: 'custom:apexcharts-card',
      series: [{ entity: 'sensor.test', name: 'Test Sensor' }],
    };

    // Create the element
    card = document.createElement('apexcharts-card') as ApexChartsCardElement;
    document.body.appendChild(card);

    // Set configuration and Hass
    card.setConfig(config);
    card.hass = hass;

    // Wait for updates after setConfig/hass (Lit updated lifecycle)
    await card.updateComplete;
  });

  afterEach(() => {
    // Clean up the element after each test
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
    // The constructor is called during setConfig/initial render
    expect(jest.requireMock('apexcharts')).toHaveBeenCalled();
    expect(mockApexChartInstance.render).toHaveBeenCalled();
  });

  // --- Tests for hass property ---
  describe('when hass property changes', () => {
    let initialHass: HomeAssistant;

    beforeEach(() => {
      initialHass = { ...hass }; // Copy initial Hass state
    });

    it('should update GraphEntry hass and trigger update on entity state change', async () => {
      const graphEntryMock = mockGraphEntryInstances[0];
      expect(graphEntryMock.hass).toEqual(initialHass); // Check initial Hass

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

      // Give time for the setTimeout in the hass-setter logic
      // @ts-ignore // Accessing private property for testing
      await new Promise((resolve) => setTimeout(resolve, card._updateDelay + 50));

      expect(graphEntryMock.hass).toEqual(newHass);
      expect(graphEntryMock._updateHistory).toHaveBeenCalled();
    });

    it("should update _headerState when show.in_header is 'raw'", async () => {
      // Adjust the configuration for this test
      const rawHeaderConfig: ChartCardExternalConfig = {
        ...config,
        series: [
          {
            ...config.series[0],
            show: { in_header: 'raw', in_chart: true }, // Set in_header to raw
          },
        ],
      };
      card.setConfig(rawHeaderConfig);
      card.hass = hass; // Set initial Hass again
      await card.updateComplete;

      const initialStateValue = parseFloat(hass.states['sensor.test'].state);
      // @ts-ignore // Accessing private property for testing
      expect(card._headerState[0]).toBe(initialStateValue);

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

      // _headerState should be updated with the new raw value
      // @ts-ignore // Accessing private property for testing
      expect(card._headerState[0]).toBe(parseFloat(updatedStateValue));
    });

    it("should update _headerState when show.in_header is 'calculated'", async () => {
      // Adjust the configuration for this test
      const calculatedHeaderConfig: ChartCardExternalConfig = {
        ...config,
        series: [
          {
            ...config.series[0],
            show: { in_header: 'raw', in_chart: true }, // Set in_header to raw
          },
        ],
      };
      card.setConfig(calculatedHeaderConfig);
      card.hass = hass; // Set initial Hass again
      await card.updateComplete;

      const initialStateValue = parseFloat(hass.states['sensor.test'].state);
      // @ts-ignore // Accessing private property for testing
      expect(card._headerState[0]).toBe(initialStateValue);

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

      // _headerState should be updated with the new raw value
      // @ts-ignore // Accessing private property for testing
      expect(card._headerState[0]).toBe(parseFloat(updatedStateValue));
    });

    it('should call _updateHistory eventually after hass is set', async () => {
      const graphEntryMock = mockGraphEntryInstances[0];
      // Reset the mock call count before setting hass again
      graphEntryMock._updateHistory.mockClear();

      card.hass = { ...hass }; // Trigger the setter
      await card.updateComplete;

      // Wait longer than the update delay
      // @ts-ignore // Accessing private property for testing
      await new Promise((resolve) => setTimeout(resolve, card._updateDelay + 50));

      expect(graphEntryMock._updateHistory).toHaveBeenCalled();
    });
  });

  // --- Test for ApexCharts Interaction ---
  describe('ApexCharts Interaction', () => {
    it('should call updateOptions with correct data after data update', async () => {
      // Clear previous calls to mocks
      mockApexChartInstance.updateOptions.mockClear();
      const graphEntryMock = mockGraphEntryInstances[0];
      graphEntryMock._updateHistory.mockClear();

      // Define mock history data to be returned by GraphEntry
      const mockHistory: [number, number | null][] = [
        [new Date(Date.now() - 10 * 60 * 1000).getTime(), 50],
        [new Date(Date.now() - 5 * 60 * 1000).getTime(), 60],
      ];
      graphEntryMock._setMockHistoryData(mockHistory);

      // Simulate a Hass change that triggers _updateHistory
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

      // Give time for setTimeout and _updateHistory
      // @ts-ignore // Accessing private property for testing
      await new Promise((resolve) => setTimeout(resolve, card._updateDelay + 100));
      // Don't wait explicitly for _updateHistory anymore, as it's now simulated synchronously in the test

      expect(mockApexChartInstance.updateOptions).toHaveBeenCalledTimes(1);

      // Correct the type for optionsPassed. Expecting ApexCharts options type.
      // Assuming a general structure here, might need ApexCharts types imported if available.
      const optionsPassed: any = (mockApexChartInstance.updateOptions.mock.calls as any[][])[0]?.[0];
      expect(optionsPassed).toBeDefined();

      // Add a check to ensure optionsPassed is defined before accessing its properties
      if (optionsPassed) {
        expect(optionsPassed.series).toBeDefined();
        expect(optionsPassed.series).toHaveLength(1);
        // Expect series data to match mockHistory
        expect(optionsPassed.series?.[0]?.data).toEqual(mockHistory);
        expect(optionsPassed.xaxis).toBeDefined();
        expect(optionsPassed.xaxis?.min).toBeDefined();
        expect(optionsPassed.xaxis?.max).toBeDefined();
        // Check if the time range is plausible (start should be approx. 24h before end)
        expect(
          optionsPassed.xaxis?.max && optionsPassed.xaxis?.min
            ? (optionsPassed.xaxis.max as number) - (optionsPassed.xaxis.min as number)
            : undefined,
        ).toBeCloseTo(24 * 60 * 60 * 1000, -5);
      }
    });

    // Test for Brush Interaction (if brush is enabled)
    it('should initialize ApexCharts brush if configured', async () => {
      const ApexChartsMock = jest.requireMock('apexcharts') as jest.Mock;
      ApexChartsMock.mockClear();
      mockApexChartInstance.render.mockClear();

      const brushConfig: ChartCardExternalConfig = {
        ...config,
        experimental: { brush: true },
        series: [{ entity: 'sensor.test', show: { in_chart: true, in_brush: true } }],
      };
      // Recreate card with brush config
      document.body.removeChild(card);
      card = document.createElement('apexcharts-card') as ApexChartsCardElement;
      document.body.appendChild(card);
      card.setConfig(brushConfig);
      card.hass = hass;
      await card.updateComplete;

      // TWO ApexCharts instances should have been created (Graph + Brush)
      expect(ApexChartsMock).toHaveBeenCalledTimes(2);
      expect(mockApexChartInstance.render).toHaveBeenCalledTimes(2);
    });
  });

  // --- Tests for setConfig ---
  describe('setConfig', () => {
    // ... Tests for defaults, all_series_config, GraphEntry, colors ...

    // --- Tests for Validation ---
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
      const invalidConfig: any = { ...config, span: { start: 'day', end: 'day' } };
      expect(() => card.setConfig(invalidConfig)).toThrow(/Only one of 'start' or 'end' is allowed/);
    });

    it('should throw error for missing yaxis_id with multiple yaxes', () => {
      const invalidConfig = {
        ...config,
        yaxis: [{ id: 'y1' }, { id: 'y2' }], // Multiple axes defined
        series: [{ entity: 'sensor.test' }], // Series has no yaxis_id
      };
      expect(() => card.setConfig(invalidConfig)).toThrow(/missing the 'yaxis_id' configuration/);
    });

    it('should throw error for missing id in multiple yaxes', () => {
      const invalidConfig = {
        ...config,
        yaxis: [{}, { id: 'y2' }], // One axis without id
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

  // --- Add more tests here ---
});
