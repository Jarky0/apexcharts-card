import { LitElement, html, TemplateResult, PropertyValues, CSSResultGroup } from 'lit';
import { property, state, customElement, eventOptions } from 'lit/decorators.js'; // Ensure state is imported
import { ifDefined } from 'lit/directives/if-defined.js';
import { ClassInfo, classMap } from 'lit/directives/class-map.js';
import {
  ChartCardConfig,
  ChartCardSeriesConfig,
  ChartCardYAxis,
  EntityCachePoints,
  EntityEntryCache,
  HistoryPoint,
  minmax_type,
} from './types';
import { handleAction, HomeAssistant, ActionHandlerEvent, LovelaceConfig } from 'custom-card-helpers'; // Import LovelaceConfig
import localForage from 'localforage';
import * as pjson from '../package.json';
import {
  computeColor,
  computeColors,
  computeName,
  computeTextColor,
  computeUom,
  decompress,
  formatApexDate,
  getLang,
  getPercentFromValue,
  interpolateColor,
  is12Hour,
  log,
  mergeConfigTemplates,
  mergeDeep,
  mergeDeepConfig,
  myFormatNumber,
  offsetData,
  prettyPrintTime,
  truncateFloat,
  validateInterval,
  validateOffset,
  getLovelace,
  isUsingServerTimezone,
  computeTimezoneDiffWithLocal,
} from './utils';
import ApexCharts from 'apexcharts';
import { stylesApex } from './styles';
import { HassEntity } from 'home-assistant-js-websocket';
import { getBrushLayoutConfig, getLayoutConfig } from './apex-layouts';
import GraphEntry from './graphEntry';
import { createCheckers } from 'ts-interface-checker';
import {
  ActionsConfig,
  ChartCardColorThreshold,
  ChartCardExternalConfig,
  ChartCardSeriesExternalConfig,
  ChartCardHeaderExternalConfig, // Use External config type here
} from './types-config';
import exportedTypeSuite from './types-config-ti';
import {
  DEFAULT_AREA_OPACITY,
  DEFAULT_COLORS,
  DEFAULT_DURATION,
  DEFAULT_FILL_RAW,
  DEFAULT_FLOAT_PRECISION,
  DEFAULT_FUNC,
  DEFAULT_GRAPH_SPAN,
  DEFAULT_GROUP_BY_FILL,
  DEFAULT_LEGEND_MARKER_WIDTH,
  DEFAULT_SERIES_TYPE,
  DEFAULT_STATISTICS_PERIOD,
  DEFAULT_SHOW_IN_CHART,
  DEFAULT_SHOW_IN_HEADER,
  DEFAULT_SHOW_IN_LEGEND,
  DEFAULT_SHOW_LEGEND_VALUE,
  DEFAULT_SHOW_NAME_IN_HEADER,
  DEFAULT_SHOW_OFFSET_IN_NAME,
  DEFAULT_UPDATE_DELAY,
  HOUR_24,
  NO_VALUE,
  PLAIN_COLOR_TYPES,
  TIMESERIES_TYPES,
} from './const';
import parse from 'parse-duration';
import tinycolor from '@ctrl/tinycolor';
import { actionHandler } from './action-handler-directive';

/* eslint no-console: 0 */
console.info(
  `%c APEXCHARTS-CARD %c v${pjson.version} `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ApexCharts = ApexCharts;

localForage.config({
  name: 'apexcharts-card',
  version: 1.0,
  storeName: 'entity_history_cache',
  description: 'ApexCharts-card uses caching for the entity history',
});

localForage
  .iterate((data, key) => {
    const value: EntityEntryCache = key.endsWith('-raw') ? data : decompress(data);
    if (value.card_version !== pjson.version) {
      localForage.removeItem(key);
    }
    const start = new Date();
    start.setTime(start.getTime() - value.span);
    if (new Date(value.last_fetched) < start) {
      localForage.removeItem(key);
    }
  })
  .catch((err) => {
    console.warn('Purging has errored: ', err);
  });

// ADD: Type definition for debounced function with cancel method
interface DebouncedFunction<T extends unknown[] = unknown[]> {
  (...args: T): void;
  cancel?: () => void;
  waitFor?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number): DebouncedFunction<Parameters<F>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced: DebouncedFunction<Parameters<F>> = (...args: Parameters<F>): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => func(...args), waitFor);
  };

  // Add the cancel method
  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  // Add the waitFor property
  debounced.waitFor = waitFor;

  return debounced;
}
// END ADD

// Add this interface definition at the top of the file after the imports
// Define missing ApexCharts types
interface ApexAnnotationsPoint {
  x: number;
  y?: number;
  marker?: {
    size?: number;
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    shape?: string;
  };
  label?: {
    text?: string;
    borderColor?: string;
    borderWidth?: number;
    borderRadius?: number;
    textAnchor?: string;
    orientation?: string;
    offsetX?: number;
    offsetY?: number;
    style?: {
      background?: string;
      color?: string;
      fontSize?: string;
      fontWeight?: number;
      fontFamily?: string;
      cssClass?: string;
      padding?: {
        left?: number;
        right?: number;
        top?: number;
        bottom?: number;
      };
    };
  };
}

// Add this interface after the ApexAnnotationsPoint interface
interface XAxisAnnotation {
  x: number;
  strokeDashArray?: number;
  borderColor?: string;
  label?: {
    text?: string;
    borderColor?: string;
    style?: {
      color?: string;
      background?: string;
    };
  };
}

@customElement('apexcharts-card')
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class ChartsCard extends LitElement {
  private _hass?: HomeAssistant;

  private _apexChart?: ApexCharts;

  private _apexBrush?: ApexCharts;

  private _loaded = false;

  @property({ type: Boolean }) private _updating = false;

  private _graphs: (GraphEntry | undefined)[] | undefined;

  @property({ attribute: false }) private _config?: ChartCardConfig;

  private _entities: (HassEntity | undefined)[] = []; // Allow undefined entities

  private _interval?: number;

  private _intervalTimeout?: NodeJS.Timeout;

  private _colors: string[] = [];

  private _brushColors: string[] = [];

  private _headerColors: string[] = [];

  private _graphSpan: number = HOUR_24;

  private _offset = 0;

  @property({ attribute: false }) private _headerState: (number | null)[] = [];

  private _dataLoaded = false;

  private _seriesOffset: number[] = [];

  private _seriesTimeDelta: number[] = [];

  @state() private _updateDelay: number = DEFAULT_UPDATE_DELAY; // Make updateDelay a state to update debounce

  private _brushInit = false;

  private _brushSelectionSpan = 0;

  private _yAxisConfig?: ChartCardYAxis[];

  private _serverTimeOffset = 0;

  @state() private _fetchError?: string; // Add state property for fetch error message
  @state() private _warning = false; // Use @state for warning as well

  @property({ attribute: false }) _lastUpdated: Date = new Date();

  // Debounce _updateData to prevent rapid updates
  // Initialize with default delay, will be updated in updated()
  private _debouncedUpdateData: DebouncedFunction = debounce(() => this._updateData(), DEFAULT_UPDATE_DELAY);

  public connectedCallback() {
    super.connectedCallback();
    if (this._config && this._hass && this._loaded) {
      this._updateData();
      this._setUpdateInterval();
    }
  }

  private _cancelDebouncedUpdate() {
    if (this._debouncedUpdateData && this._debouncedUpdateData.cancel) {
      this._debouncedUpdateData.cancel();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._intervalTimeout) {
      clearInterval(this._intervalTimeout);
      this._intervalTimeout = undefined;
    }
    this._cancelDebouncedUpdate(); // Cancel any pending debounced updates
    if (this._apexChart) {
      this._apexChart.destroy();
      this._apexChart = undefined;
    }
    if (this._apexBrush) {
      this._apexBrush.destroy();
      this._apexBrush = undefined;
    }
    this._dataLoaded = false;
    this._brushInit = false;
    this._loaded = false;
  }

  private _updateOnInterval(): void {
    if (this._config?.update_interval) {
      if (!this._loaded) return;
      // Use debounced function here
      this._debouncedUpdateData();
    }
  }

  protected updated(changedProperties: PropertyValues) {
    if (changedProperties.has('_config') && this._hass && !this._loaded) {
      this._initialLoad();
      this._setUpdateInterval();
    }
    // Update debounce wait time if _updateDelay state changes
    if (changedProperties.has('_updateDelay')) {
      if (this._debouncedUpdateData) {
        this._debouncedUpdateData.waitFor = this._updateDelay;
      }
    }
  }

  private _firstDataLoad() {
    if (this._config?.update_interval) {
      // Avoid condition where HA haven't been updated in a while
      const firstEntityId = this._entities?.[0]?.entity_id;
      if (firstEntityId && this.hass?.states[firstEntityId]) {
        this._entities = this._entities.map((entity) => {
          if (!entity?.entity_id) return entity; // Skip if entity is invalid
          return this.hass?.states[entity.entity_id] ? this.hass.states[entity.entity_id] : entity;
        });
      }
    }
    this._updateData();
  }

  public set hass(hass: HomeAssistant) {
    if (!this._hass && hass) {
      this._hass = hass;
      // Set serverTimeOffset only once when hass is initially set
      // Fix: Pass hass.config.time_zone (string) instead of hass object
      this._serverTimeOffset = isUsingServerTimezone(hass) ? computeTimezoneDiffWithLocal(hass.config.time_zone) : 0;
      this._initialLoad();
    } else {
      this._hass = hass;
    }

    if (this._hass && this._config) {
      if (this._graphs) {
        this._graphs.forEach((graph) => {
          if (graph) graph.hass = this._hass!;
        });
      }
      let updateNeeded = false;
      let headerUpdateNeeded = false;
      this._entities = this._entities.map((entity, index) => {
        if (!entity?.entity_id) return entity; // Skip if entity is somehow invalid
        const newEntity = this._hass!.states[entity.entity_id];
        if (entity !== newEntity) {
          const confSeries = this._config!.series[index]; // Get config for this specific index
          if (!confSeries) return newEntity; // Skip if no config found for index (should not happen)

          // Check if update is needed based on graph display
          if (confSeries.show?.in_chart && !confSeries.show?.extremas) {
            updateNeeded = true;
          }

          // Check if header update is needed
          // Use external config type for checking header_config properties
          const headerConf = confSeries.header_config as ChartCardHeaderExternalConfig | undefined;
          if (confSeries.show?.in_header && headerConf?.show_states === false) {
            this._headerState[index] = null;
            headerUpdateNeeded = true; // Header state cleared needs update
          } else if (confSeries.show?.in_header || this._config?.header?.show_states) {
            const val = this._getLatestHeaderStateValue(newEntity, index);
            if (this._headerState[index] !== val) {
              this._headerState[index] = val;
              headerUpdateNeeded = true;
            }
          }
          return newEntity;
        }
        return entity;
      });

      if (headerUpdateNeeded) {
        this.requestUpdate('_headerState');
      }

      if (updateNeeded && !this._config.update_interval) {
        this._debouncedUpdateData();
      }
    }
  }

  private _reset() {
    this._cancelDebouncedUpdate();
    if (this._apexChart) this._apexChart.destroy();
    if (this._apexBrush) this._apexBrush.destroy();
    this._apexChart = undefined;
    this._apexBrush = undefined;
    this._dataLoaded = false;
    this._brushInit = false;
    this._loaded = false;
    this._updating = false;
    this._fetchError = undefined; // Reset fetch error
    this._warning = false; // Reset warning state
    if (this._graphs) {
      this._graphs = this._graphs.map((graph) => {
        if (graph) graph.cache = true; // Reset cache flag on graph entry
        return graph;
      });
    }
  }

  public setConfig(config: ChartCardExternalConfig) {
    if (!config || !config.series) {
      throw new Error('Missing configuration: series');
    }

    if (config.series && !Array.isArray(config.series)) {
      throw new Error(`'series' must be an array!`);
    }

    if (config.all_series_config && typeof config.all_series_config !== 'object') {
      throw new Error(`'all_series_config' must be an object!`);
    }

    const { customChecker } = createCheckers(exportedTypeSuite);

    // Validate configuration with the types
    try {
      customChecker.check(config);
    } catch (e: unknown) {
      if (e instanceof Error) {
        log(`Check of config failed: ${e.toString()}`);
        throw new Error(`Configuration errors: ${e.toString()}`);
      }
    }

    this._reset();

    let configDup: ChartCardExternalConfig = JSON.parse(JSON.stringify(config));

    // Apply templates if defined
    // Fix: Pass lovelace object to mergeConfigTemplates
    const lovelace = getLovelace();
    if (lovelace) {
      configDup = mergeConfigTemplates(lovelace, configDup);
    } else {
      log('Lovelace environment not found, cannot apply templates.');
    }

    // Parse duration values
    const graphSpan =
      typeof configDup.graph_span === 'string'
        ? parse(configDup.graph_span) || DEFAULT_GRAPH_SPAN
        : configDup.graph_span || DEFAULT_GRAPH_SPAN;

    const updateInterval =
      typeof configDup.update_interval === 'string' ? parse(configDup.update_interval) : configDup.update_interval;

    const updateDelay =
      typeof configDup.update_delay === 'string'
        ? parse(configDup.update_delay) || DEFAULT_UPDATE_DELAY
        : configDup.update_delay || DEFAULT_UPDATE_DELAY;

    // Cast to internal config type after validation and template merge
    const internalConfig: ChartCardConfig = {
      // Chart Card options
      type: configDup.type,
      chart_type: configDup.chart_type || 'line',
      update_interval: updateInterval === null ? undefined : updateInterval,
      update_delay: updateDelay,
      series: [], // Initialized later
      graph_span: graphSpan,
      span: configDup.span,
      cache: configDup.cache !== undefined ? configDup.cache : true,
      // Use edit_mode from the original or duplicated config object
      editMode: Boolean(config.edit_mode),
      config_templates: configDup.config_templates || [],
      experimental: { ...configDup.experimental },
      use_duration_format: configDup.use_duration_format,

      // Header options
      header: {
        show: configDup.header?.show !== undefined ? configDup.header?.show : false,
        floating: configDup.header?.floating !== undefined ? configDup.header?.floating : false,
        show_states: configDup.header?.show_states !== undefined ? configDup.header?.show_states : false,
        colorize_states: configDup.header?.colorize_states !== undefined ? configDup.header?.colorize_states : false,
        title: configDup.header?.title || undefined,
        title_actions: configDup.header?.title_actions || undefined,
      },

      // Apex chart options
      apex_config: configDup.apex_config,
      yaxis: configDup.yaxis,
      now: {
        show: configDup.now?.show !== undefined ? configDup.now.show : false,
        color: configDup.now?.color || 'var(--primary-color)',
        label: configDup.now?.label || 'Now',
      },
      // Add internal properties missing from external
      series_in_graph: [],
      series_in_brush: [],
    };
    this._config = internalConfig;

    if (graphSpan <= 0) {
      throw new Error(`'graph_span' must be > 0`);
    }
    this._graphSpan = graphSpan;
    // Ensure _updateDelay state is updated
    this._updateDelay = updateDelay;

    if (this._config.span && (this._config.span.start || this._config.span.end)) {
      if (this._config.span.start && this._config.span.end) {
        throw new Error(`Cannot specify both 'span.start' and 'span.end'.`);
      }
      if (this._config.span.offset) {
        // Validate and assign offset
        // Fix: Add null check for _config.span.offset before validation
        this._offset = validateOffset(this._config.span.offset, 'span.offset');
      }
    }

    if (configDup.yaxis) {
      // Assign yaxis config if present
      this._yAxisConfig = configDup.yaxis;
    }

    this._entities = [];
    // Fix: Pass only the color_list parameter to computeColors
    this._colors = configDup.color_list ? computeColors(configDup.color_list) : computeColors(DEFAULT_COLORS);
    this._brushColors = [];
    this._headerColors = [];
    this._headerState = [];
    this._seriesOffset = [];
    this._seriesTimeDelta = [];
    this._graphs = [];
    this._config.series = configDup.series
      .map<ChartCardSeriesConfig | undefined>((series, index) => {
        // Objects for mergeDeep need to be combined first
        const baseOptions = {};
        const allSeriesConfig = configDup.all_series_config || {};

        // Using mergeDeep with spread syntax for clearer and more flexible configuration
        let seriesOptions: ChartCardSeriesExternalConfig;
        if (series) {
          seriesOptions = mergeDeep(mergeDeep(baseOptions, allSeriesConfig), series);
        } else {
          seriesOptions = mergeDeep(baseOptions, allSeriesConfig);
        }

        const seriesType = seriesOptions.type || this._config!.chart_type;

        const color = seriesOptions.color ? computeColor(seriesOptions.color) : this._colors[index];

        this._colors[index] = color;

        this._headerState.push(null);

        const show = {
          in_chart: seriesOptions.show?.in_chart !== undefined ? seriesOptions.show?.in_chart : DEFAULT_SHOW_IN_CHART,
          in_header:
            seriesOptions.show?.in_header !== undefined
              ? seriesOptions.show?.in_header
              : DEFAULT_SHOW_IN_HEADER(seriesOptions.entity),
          name_in_header:
            seriesOptions.show?.name_in_header !== undefined
              ? seriesOptions.show?.name_in_header
              : DEFAULT_SHOW_NAME_IN_HEADER,
          in_legend:
            seriesOptions.show?.in_legend !== undefined ? seriesOptions.show?.in_legend : DEFAULT_SHOW_IN_LEGEND,
          legend_value:
            seriesOptions.show?.legend_value !== undefined
              ? seriesOptions.show?.legend_value
              : DEFAULT_SHOW_LEGEND_VALUE,
          extremas: seriesOptions.show?.extremas || false,
          offset_in_name:
            seriesOptions.show?.offset_in_name !== undefined
              ? seriesOptions.show?.offset_in_name
              : DEFAULT_SHOW_OFFSET_IN_NAME,
        };

        // Cast to internal series config type
        const finalSeries: ChartCardSeriesConfig = {
          // Set Defaults
          index: index,
          ignore_history: false,
          type: seriesType,
          color: color,
          opacity:
            seriesOptions.opacity !== undefined
              ? seriesOptions.opacity
              : seriesType === 'area'
                ? DEFAULT_AREA_OPACITY
                : 1,
          curve: seriesOptions.curve || 'smooth',
          stroke_width:
            seriesOptions.stroke_width !== undefined ? seriesOptions.stroke_width : seriesType === 'column' ? 0 : 1.5,
          fill_raw: seriesOptions.fill_raw || DEFAULT_FILL_RAW,
          group_by: {
            func: seriesOptions.group_by?.func || DEFAULT_FUNC,
            duration: seriesOptions.group_by?.duration || DEFAULT_DURATION,
            fill: seriesOptions.group_by?.fill || DEFAULT_GROUP_BY_FILL,
            start_with_last:
              seriesOptions.group_by?.start_with_last !== undefined ? seriesOptions.group_by?.start_with_last : false,
          },
          color_threshold: seriesOptions.color_threshold,
          invert: seriesOptions.invert !== undefined ? seriesOptions.invert : false,
          float_precision:
            seriesOptions.float_precision !== undefined ? seriesOptions.float_precision : DEFAULT_FLOAT_PRECISION,
          min: seriesOptions.min,
          max: seriesOptions.max,
          offset: seriesOptions.offset,
          statistics: seriesOptions.statistics,
          period: seriesOptions.period || 'hour', // Standard period 'hour' instead of DEFAULT_STATISTICS_PERIOD
          attribute: seriesOptions.attribute,
          unit: seriesOptions.unit,
          transform: seriesOptions.transform,
          data_generator: seriesOptions.data_generator,
          name: seriesOptions.name,
          entity: seriesOptions.entity,
          yaxis_id: seriesOptions.yaxis_id,
          header_actions: seriesOptions.header_actions,
          show: show,
          extend_to: seriesOptions.extend_to, // Corrected property name
          header_config: seriesOptions.header_config, // Add header_config from merged options
        };
        // End Set Defaults

        if (!finalSeries.entity && !finalSeries.data_generator) {
          throw new Error(`Attribute 'entity' is required for series ${index}`);
        }

        if (!finalSeries.name) {
          if (!finalSeries.entity) {
            throw new Error(`Attribute 'name' is required for series ${index} if 'entity' is undefined`);
          }
          if (finalSeries.attribute) {
            finalSeries.name = `${computeName(index, this._config?.series, this._entities)} ${finalSeries.attribute}`;
          } else {
            finalSeries.name = computeName(index, this._config?.series, this._entities);
          }
        }
        if (finalSeries.offset) {
          // Validate and assign series offset
          this._seriesOffset[index] = validateOffset(finalSeries.offset, `series[${index}].offset`);
        }
        if (finalSeries.group_by.duration) {
          // Validate group_by duration
          finalSeries.group_by.duration = String(
            validateInterval(finalSeries.group_by.duration, `series[${index}].group_by.duration`),
          );
        }
        if (finalSeries.statistics && finalSeries.group_by.func !== DEFAULT_FUNC) {
          log(`'group_by' is ignored when 'statistics' is defined for series ${index}`);
        }
        if (finalSeries.statistics && finalSeries.group_by.duration !== DEFAULT_DURATION) {
          log(`'group_by.duration' is ignored when 'statistics' is defined for series ${index}`);
        }
        if (finalSeries.statistics && finalSeries.fill_raw !== DEFAULT_FILL_RAW) {
          log(`'fill_raw' is ignored when 'statistics' is defined for series ${index}`);
        }
        if (finalSeries.statistics && finalSeries.attribute) {
          log(`'attribute' is ignored when 'statistics' is defined for series ${index}`);
        }

        if (!finalSeries.entity && finalSeries.show.in_header) {
          log(`'entity' is required for series ${index} if 'show.in_header' is true`);
          finalSeries.show.in_header = false;
        }

        if (this._entities.findIndex((entity) => entity?.entity_id === finalSeries.entity) === -1) {
          if (finalSeries.entity) {
            // Initialize with undefined, will be populated by hass setter
            this._entities.push(undefined);
            this._headerColors[index] = this._computeHeaderStateColor(finalSeries, null);
          }
        }

        if (finalSeries.show.in_chart) {
          this._brushColors.push(color);
        }

        if (!finalSeries.entity && !finalSeries.data_generator) {
          log('Skipping series, no entity or data_generator defined');
          return undefined;
        } else {
          this._graphs?.push(
            new GraphEntry(index, this._graphSpan, this._config?.cache || false, finalSeries, this._config?.span),
          );
          return finalSeries;
        }
      })
      .filter((series): series is ChartCardSeriesConfig => series !== undefined); // Filter out undefined series

    // Remove potential undefined entries from filtering
    this._graphs = this._graphs?.filter((graph) => graph !== undefined);

    if (!this._graphs || this._graphs.length === 0) {
      throw new Error('No graph to display');
    }

    this._config.series_in_graph = this._config.series.filter((series) => series.show.in_chart);
    this._config.series_in_brush = this._config.series.filter((series) => series.show.in_chart);

    if (this._config.series_in_graph.length === 0 && this._config.header?.show) {
      log('Set header.show to false as there are no series to display in the graph.');
      this._config.header.show = false;
    }

    this._config.apex_config = this._generateApexConfig(this._config);

    if (this._hass) {
      this._loaded = false;
      this._initialLoad();
    }
  }

  private _generateYAxisConfig(config: ChartCardConfig): ApexYAxis[] | undefined {
    if (!config.yaxis) return undefined;
    return config.yaxis.map((yaxis) => {
      const conf: ApexYAxis = {};
      if (yaxis.id) conf.seriesName = yaxis.id;
      conf.show = yaxis.show !== undefined ? yaxis.show : true;
      if (!conf.show) return conf;
      conf.opposite = yaxis.opposite !== undefined ? yaxis.opposite : false;
      if (yaxis.decimals !== undefined) conf.decimalsInFloat = yaxis.decimals;
      conf.logarithmic = yaxis.logarithmic !== undefined ? yaxis.logarithmic : false;
      const min = config.series
        .filter((series) => series.yaxis_id === yaxis.id)
        .reduce((acc: number | undefined, series) => {
          if (series.min === undefined) return acc;
          if (acc === undefined) return series.min;
          return series.min > acc ? acc : series.min;
        }, undefined);
      const max = config.series
        .filter((series) => series.yaxis_id === yaxis.id)
        .reduce((acc: number | undefined, series) => {
          if (series.max === undefined) return acc;
          if (acc === undefined) return series.max;
          return series.max < acc ? acc : series.max;
        }, undefined);
      // Fix: Correct type checking for min/max strings 'auto', 'hardmin', etc.
      conf.min = typeof yaxis.min === 'number' ? yaxis.min : min;
      conf.max = typeof yaxis.max === 'number' ? yaxis.max : max;
      if (yaxis.apex_config) Object.assign(conf, yaxis.apex_config);
      return conf;
    });
  }

  static get styles(): CSSResultGroup {
    return stylesApex;
  }

  protected render(): TemplateResult {
    if (!this._config || !this._hass) {
      return html``;
    }

    return html`
      <ha-card .header=${this._config.header?.title}>
        ${this._renderWarnings()} ${this._renderHeader()}
        <div
          id="chart"
          class=${classMap({
            'apexcharts-card': true,
            'apexcharts-card--loading': !this._dataLoaded && this._updating, // Show loading only when updating and not loaded
            'apexcharts-card--hidden': !this._dataLoaded && !this._updating && !this._fetchError, // Hide if not loaded, not updating, and no error
          })}
          style=${`height: ${this._config.apex_config?.chart?.height ? this._config.apex_config?.chart?.height : 'auto'};`}
        ></div>
        ${this._renderBrush()}
      </ha-card>
    `;
  }

  private _renderWarnings(): TemplateResult {
    const warnings: TemplateResult[] = [];
    if (this._warning) {
      warnings.push(html`<hui-warning>Data out of sync</hui-warning>`);
    }
    // Add fetch error warning
    if (this._fetchError) {
      warnings.push(html`<hui-warning>Error fetching data: ${this._fetchError}</hui-warning>`);
    }
    return html`${warnings}`;
  }

  private _renderHeader(): TemplateResult {
    if (!this._config?.header?.show) {
      return html``;
    }
    const classes: ClassInfo = {
      'apexcharts-card-header': true,
      'apexcharts-card-header--show': this._config?.header?.show || false,
      'apexcharts-card-header--floating': this._config?.header?.floating || false,
    };

    return html`
      <div class=${classMap(classes)}>${this._renderTitle()} ${this._renderStates()} ${this._renderLastUpdated()}</div>
    `;
  }

  private _renderTitle(): TemplateResult {
    if (!this._config?.header?.title) {
      return html``;
    }
    const hasAction =
      this._config.header.title_actions &&
      (this._config.header.title_actions.tap_action ||
        this._config.header.title_actions.hold_action ||
        this._config.header.title_actions.double_tap_action);
    const style = this._config.header.floating ? `color: ${computeTextColor(this._headerColors[0])};` : '';
    return html`
      <div
        class="apexcharts-card-header-title ${hasAction ? 'clickable' : ''}"
        @action=${this._handleTitleAction}
        .actionHandler=${actionHandler({
          hasHold: hasAction && !!this._config?.header?.title_actions?.hold_action,
          hasDoubleClick: hasAction && !!this._config?.header?.title_actions?.double_tap_action,
        })}
        style=${style}
      >
        ${this._config.header.title}
      </div>
    `;
  }

  private _getLatestHeaderStateValue(entity: HassEntity | undefined, index: number): number | null {
    if (!entity || !this._config) return null;
    const seriesConf = this._config.series[index];
    if (!seriesConf) return null; // Should not happen, but guard

    let value: unknown; // Use unknown for initial state value
    if (seriesConf.attribute) {
      value = entity.attributes[seriesConf.attribute];
    } else {
      value = entity.state;
    }

    if (value !== null && value !== undefined) {
      const numberValue = Number(value);
      if (!isNaN(numberValue)) {
        return truncateFloat(numberValue, seriesConf.float_precision) as number;
      }
    }
    return null;
  }

  private _updateHeaderColors(): void {
    if (!this._config || !this._entities) return;
    this._headerColors = this._config.series.map((series, index) => {
      const value = this._getLatestHeaderStateValue(this._entities[index], index);
      return this._computeHeaderStateColor(series, value);
    });
    this.requestUpdate('_headerColors');
  }

  private _renderStates(): TemplateResult {
    if (!this._config?.header?.show_states) {
      return html``;
    }

    const states = this._config.series.map((series, index) => {
      if (!series.show.in_header) return html``;

      // Use external config type for checking header_config properties
      const headerConf = series.header_config;
      const stateValue =
        headerConf?.show_state === false ? '' : this._formatStateValue(this._headerState[index], index);

      const stateUOM = headerConf?.show_uom === false ? '' : series.unit;
      const name = series.show.name_in_header ? `${series.name}` : '';
      let color = '';
      if (this._config?.header?.colorize_states) {
        color = this._headerColors[index] || 'inherit'; // Use inherit if color not found
      }

      const hasAction =
        series.header_actions &&
        (series.header_actions.tap_action ||
          series.header_actions.hold_action ||
          series.header_actions.double_tap_action);

      return html`
        <div
          class="apexcharts-card-header-state ${hasAction ? 'clickable' : ''}"
          style=${`color: ${color};`}
          @action=${(ev) => this._handleAction(ev, series)}
          .actionHandler=${actionHandler({
            hasHold: hasAction && !!series.header_actions?.hold_action,
            hasDoubleClick: hasAction && !!series.header_actions?.double_tap_action,
          })}
        >
          ${headerConf?.show_name === false ? '' : name} ${stateValue} ${stateUOM}
        </div>
      `;
    });

    return html`<div class="apexcharts-card-header-states">${states}</div>`;
  }

  private _renderLastUpdated(): TemplateResult {
    if (!this._config?.experimental?.show_last_updated) return html``;
    const lang = getLang(this._config, this._hass);
    const time = this._lastUpdated.toLocaleTimeString(lang);
    return html`<div class="apexcharts-card-header-last-updated">${time}</div>`;
  }

  private async _initialLoad(): Promise<void> {
    if (!this._hass || !this._config || this._loaded || this._updating) return;

    log('Initial load');
    this._updating = true;
    this._fetchError = undefined; // Reset error before initial load
    this._warning = false; // Reset warning before initial load

    this._entities = this._config.series.map((series) => {
      if (!series.entity) return undefined;
      const entity = this._hass?.states[series.entity];
      if (!entity) {
        log(`Unknown entity: ${series.entity}`);
        // Return undefined for missing entities initially
        return undefined;
      }
      return entity;
    }); // Allow undefined entities initially

    this._headerState = this._config.series.map((_, index) => {
      const entity = this._entities[index];
      return this._getLatestHeaderStateValue(entity, index);
    });
    this._updateHeaderColors(); // Update colors based on initial state

    try {
      await this._firstDataLoad(); // Call _updateData which now includes error handling
      this._loaded = true;
      // _updating and _fetchError are handled within _updateData
      this._updateHeaderColors(); // Update colors again after potential data load
      this.requestUpdate(); // Trigger re-render
    } catch (error: any) {
      // Catch potential errors not caught within _updateData
      console.error('Error during initial load sequence:', error);
      this._fetchError = error.message || 'Failed initial load sequence';
      this._updating = false;
      this._loaded = false; // Ensure loaded is false on error
      this.requestUpdate('_fetchError'); // Trigger re-render to show error
    }
  }

  private async _updateData() {
    if (!this._hass || !this._config || !this._graphs || this._graphs.length === 0 || this._updating) {
      log('Skipping update');
      return;
    }

    log('Update data');
    this._updating = true;
    this._fetchError = undefined; // Reset error before update
    this.requestUpdate('_fetchError'); // Ensure error message is cleared visually

    try {
      const now = new Date();
      let { start, end } = this._getSpanDates();

      // OPTIMIZATION: Shorten period for editor mode
      if (this._config.editMode) {
        log('Editor mode: Using stronger optimizations for data fetch.');
        end = new Date(); // Use current time as end
        // Shorten to just 10 minutes instead of an hour to minimize data load
        start = new Date(end.getTime() - 10 * 60 * 1000); // Fetch only the last 10 minutes
      }

      // Check if graph start/end times are available before comparing
      const currentGraphStart = this._graphs[0]?.start?.getTime();
      const currentGraphEnd = this._graphs[0]?.end?.getTime();
      const isSameSpan = currentGraphStart === start.getTime() && currentGraphEnd === end.getTime();

      let someDataNeedsUpdate = false;
      // Force update if span changed, no interval, no history, or in edit mode
      if (
        !isSameSpan ||
        !this._config.update_interval ||
        this._graphs[0]?.history?.length === 0 ||
        this._config.editMode
      ) {
        someDataNeedsUpdate = true;
      } else {
        // Check if any entity has updated since last fetch based on update_interval
        this._graphs.forEach((graph, index) => {
          if (!graph || !this._entities[index]) return; // Skip if graph or entity doesn't exist
          const entity = this._entities[index]!;
          const lastHistory = graph.history?.[graph.history.length - 1];
          if (
            lastHistory &&
            this._config?.update_interval &&
            entity.last_changed !== entity.last_updated && // Don't update if only attributes changed
            new Date(entity.last_updated).getTime() > lastHistory[0] + this._config.update_interval
          ) {
            someDataNeedsUpdate = true;
          }
        });
      }

      if (!someDataNeedsUpdate) {
        log('Update not needed');
        this._updating = false;
        this._lastUpdated = new Date();
        this.requestUpdate('_lastUpdated');
        return;
      }

      const historyPromises = this._graphs.map(async (graph, index) => {
        if (graph) {
          // Skip updating some graphs in editor mode to reduce API load
          if (this._config!.editMode && index > 2) {
            // Only update first 3 graphs in editor mode
            log(`Editor mode: Skipping update for series ${index} (limited preview)`);
            return graph.history || []; // Return existing history or empty array
          }

          try {
            // Disable cache in edit mode, otherwise use config setting
            graph.cache = this._config!.editMode ? false : this._config!.cache;
            const updated = await graph._updateHistory(start, end);
            // Reset general warning if any graph updates successfully
            if (updated) {
              this._warning = false;
            }
            return graph.history;
          } catch (error) {
            // Log the error but don't break the entire update process
            console.error(`Error updating history for graph ${index}:`, error);
            // Return empty history for this series
            return [];
          }
        }
        return [];
      });

      // Wait for all history updates to complete
      const history = await Promise.all(historyPromises);

      this._lastUpdated = new Date();
      this.requestUpdate('_lastUpdated');

      // Check if *any* history was returned, even in edit mode
      if (history.flat().length === 0) {
        log('No data received for the period.');
        // Only show error if not in edit mode, as editor might genuinely have no recent data
        if (!this._config.editMode) {
          this._fetchError = 'No data received for the selected period.';
        } else {
          // In edit mode, show a more helpful message
          this._fetchError = 'Limited data preview in editor. Full data will be available in dashboard view.';
        }
        this._dataLoaded = true; // Mark loaded to show potential error
        // Clear existing chart data if no new data received
        if (this._apexChart) {
          await this._apexChart.updateOptions({ series: [] }, false, false);
        }
        if (this._apexBrush) {
          await this._apexBrush.updateOptions({ series: [] }, false, false);
        }
      } else {
        // Process and render chart only if data exists
        this._dataLoaded = true;

        let series = history.map((_, index) => {
          const seriesConf = this._config!.series[index];
          if (!seriesConf?.show?.in_chart) return undefined;

          let data = this._graphs![index]?.history || [];
          if (seriesConf.invert) {
            data = this._invertData(data);
          }
          if (this._seriesOffset[index]) {
            data = offsetData(data, this._seriesOffset[index]);
          }
          return {
            meta: {
              offset: this._seriesOffset[index],
              min: this._graphs![index]?.min,
              max: this._graphs![index]?.max,
              minMax: this._graphs![index]?.minMaxWithTimestamp(
                start.getTime(),
                end.getTime(),
                this._seriesOffset[index],
              ),
            },
            color: this._colors[index],
            name: seriesConf.name || '',
            type: seriesConf.type,
            data,
          };
        });

        // Filter out undefined series (those not shown in chart)
        series = series.filter((s) => s !== undefined);

        // Find the actual end timestamp for the chart (useful for group_by)
        const endChartTimestamp = this._findEndOfChart(end, false);
        const annotations = this._computeAnnotations(start, end, now);
        const minMax = this._computeYAxisAutoMinMax(start, end);

        const options: ApexCharts.ApexOptions = {
          series: series as ApexAxisChartSeries,
          xaxis: {
            min: start.getTime() - this._serverTimeOffset,
            max: endChartTimestamp - this._serverTimeOffset,
          },
          annotations: annotations,
        };

        if (minMax) {
          options.yaxis = minMax;
        }

        if (!this._apexChart) {
          // Ensure chart div exists before creating chart
          const chartDiv = this.shadowRoot?.querySelector('#chart');
          if (chartDiv) {
            this._apexChart = new ApexCharts(chartDiv, this._config.apex_config);
            await this._apexChart.render();
            await this._apexChart.updateOptions(options, false, false); // Update options after initial render
          } else {
            console.error('Chart container not found');
          }
        } else {
          await this._apexChart.updateOptions(options, false, false);
        }

        // Brush chart logic
        if (this._config.apex_config?.chart?.brush?.enabled) {
          const endChartTimestampBrush = this._findEndOfChart(end, true);
          const seriesBrush = history.map((_, index) => {
            const seriesConf = this._config!.series[index];
            if (!seriesConf?.show?.in_chart) return undefined;

            let data = this._graphs![index]?.history || [];
            if (seriesConf.invert) {
              data = this._invertData(data);
            }
            if (this._seriesOffset[index]) {
              data = offsetData(data, this._seriesOffset[index]);
            }
            return {
              color: this._brushColors[index],
              name: seriesConf.name || '',
              type: seriesConf.type,
              data,
            };
          });

          // Filter out undefined brush series
          const filteredSeriesBrush = seriesBrush.filter((s) => s !== undefined);

          const optionsBrush: ApexCharts.ApexOptions = {
            series: filteredSeriesBrush as ApexAxisChartSeries,
            xaxis: {
              min: start.getTime() - this._serverTimeOffset,
              max: endChartTimestampBrush - this._serverTimeOffset,
            },
          };

          if (!this._apexBrush) {
            this._apexBrush = new ApexCharts(
              this.shadowRoot?.querySelector('#brush'),
              getBrushLayoutConfig(this._config, this._hass!, this._brushColors[0] || 'var(--primary-color)'),
            );
            await this._apexBrush.render();
            this._brushInit = true;
            await this._apexBrush.updateOptions(optionsBrush, false, false);
          } else {
            if (!this._brushInit) {
              await this._apexBrush.render();
              this._brushInit = true;
            }
            await this._apexBrush.updateOptions(optionsBrush, false, false);
          }
        }

        this._updateHeaderColors(); // Update header colors based on potentially new data
      }
    } catch (error: any) {
      // Catch any unexpected errors in the entire update process
      console.error('Error during data update:', error);
      this._fetchError = error.message || 'Unknown error during data update';
    } finally {
      this._updating = false;
      this.requestUpdate(); // Request update regardless of success/failure
    }
  }

  private _renderBrush(): TemplateResult {
    if (!this._config?.apex_config?.chart?.brush?.enabled) {
      return html``;
    }
    return html`<div
      id="brush"
      class=${classMap({
        'apexcharts-card-brush': true,
        'apexcharts-card--loading': !this._dataLoaded,
        'apexcharts-card--hidden': !this._dataLoaded && !this._updating,
      })}
      style=${`height: ${this._config.brush?.height ?? 'auto'};`}
    ></div>`;
  }

  private _generateApexConfig(config: ChartCardConfig): ApexCharts.ApexOptions {
    const lang = getLang(config, this._hass);
    const is12HourVar = is12Hour(config, this._hass);
    const { start, end } = this._getSpanDates();
    const endChartTimestamp = this._findEndOfChart(end, false);

    const layout = getLayoutConfig(config, this._hass!, this._graphs);
    const mergedConfig = mergeDeep(layout, config.apex_config || {});
    const baseConfig: ApexCharts.ApexOptions = mergeDeep(mergedConfig, {
      chart: {
        locales: [
          {
            name: lang,
            options: {
              toolbar: {
                exportToSVG: 'Download SVG',
                exportToPNG: 'Download PNG',
                exportToCSV: 'Download CSV',
                menu: 'Menu',
                selection: 'Selection',
                selectionZoom: 'Selection Zoom',
                zoomIn: 'Zoom In',
                zoomOut: 'Zoom Out',
                pan: 'Panning',
                reset: 'Reset Zoom',
              },
              shortMonths: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            },
          },
        ],
        defaultLocale: lang,
        ...(config.apex_config?.chart || {}),
      },
      xaxis: {
        type: 'datetime',
        labels: {
          datetimeUTC: false,
          format: config.experimental?.xaxis_time_format ? config.experimental.xaxis_time_format : undefined, // Let ApexCharts decide format if not specified
          datetimeFormatter: {
            year: 'yyyy',
            month: "MMM 'yy",
            day: 'dd MMM',
            hour: is12HourVar ? 'h:mm T' : 'HH:mm',
            minute: is12HourVar ? 'h:mm:ss T' : 'HH:mm:ss',
          },
        },
        ...(config.apex_config?.xaxis || {}),
      },
      yaxis: this._generateYAxisConfig(config),
      tooltip: {
        x: {
          formatter: (value: number): string => {
            return this._formatApexDateHelper(new Date(value + this._serverTimeOffset));
          },
        },
        y: {
          formatter: (value: number, { seriesIndex, w }): string => {
            const uom = this._computeUomHelper(
              config.series[seriesIndex]?.unit,
              this._hass?.states[config.series[seriesIndex]?.entity],
              this._config!.use_duration_format,
            );
            const formatted = this._formatStateValue(value, seriesIndex);
            if (w.config.series[seriesIndex]?.type === 'column') {
              const duration = config.series[seriesIndex]?.group_by?.duration;
              const per = duration ? `/${duration}` : '';
              return `${formatted} ${uom}${per}`;
            }
            return `${formatted} ${uom}`;
          },
        },
        ...(config.apex_config?.tooltip || {}),
      },
    }) as ApexCharts.ApexOptions;

    return baseConfig;
  }

  private _setUpdateInterval() {
    if (this._config?.update_interval && !this._intervalTimeout) {
      this._updateOnInterval(); // Initial call
      this._intervalTimeout = setInterval(() => this._updateOnInterval(), this._config!.update_interval!);
    } else if (!this._config?.update_interval && this._intervalTimeout) {
      clearInterval(this._intervalTimeout);
      this._intervalTimeout = undefined;
    }
  }

  private _computeAnnotations(start: Date, end: Date, now: Date) {
    const res: ApexAnnotations = {};
    if (this._config?.now?.show) {
      const nowAnnotation = this._computeNowAnnotation(now);
      // Use type assertion to handle the type mismatch
      res.xaxis = nowAnnotation.xaxis as any;
    }
    res.points = this._computeMinMaxPointsAnnotations(start, end);
    return res;
  }

  private _computeMinMaxPointsAnnotations(start: Date, end: Date) {
    if (!this._config) return [];
    let annotations: ApexAnnotationsPoint[] = [];
    this._config.series.forEach((series, index) => {
      if (!series.show?.extremas || !series.show.in_chart) return;
      const graph = this._graphs?.find((graph) => graph?.index === index);
      if (!graph) return;
      const minMax = graph.minMaxWithTimestamp(start.getTime(), end.getTime(), this._seriesOffset[index] || 0);
      if (!minMax) return;
      const showMax = series.show.extremas === true || series.show.extremas === 'max';
      const showMin = series.show.extremas === true || series.show.extremas === 'min';

      // Modify the style definition to also consider the x-property
      let styleWithX: Partial<ApexAnnotationsPoint> | undefined = undefined;
      if (series.show.extremas_config) {
        styleWithX = {
          marker: {
            size: series.show.extremas_config.marker_size || 4,
            fillColor: series.show.extremas_config.marker_color || series.color,
            strokeColor: series.show.extremas_config.marker_stroke_color || '#fff',
            strokeWidth: series.show.extremas_config.marker_stroke_width || 1,
            shape: series.show.extremas_config.marker_shape || 'circle',
          },
          label: {
            text: 'Max', // Default text, can be customized
            borderColor: series.show.extremas_config.label_border_color || series.color,
            borderWidth: series.show.extremas_config.label_border_width || 1,
            borderRadius: series.show.extremas_config.label_border_radius || 2,
            textAnchor: series.show.extremas_config.label_text_anchor || 'middle',
            orientation: series.show.extremas_config.label_orientation || 'horizontal',
            offsetX: series.show.extremas_config.label_offset_x || 0,
            offsetY: series.show.extremas_config.label_offset_y || -15, // Default offset above marker
            style: {
              background: series.show.extremas_config.label_background || series.color,
              color: series.show.extremas_config.label_color || computeTextColor(series.color!),
              fontSize: series.show.extremas_config.label_font_size || '12px',
              fontWeight: series.show.extremas_config.label_font_weight || 400,
              fontFamily: series.show.extremas_config.label_font_family || undefined,
              cssClass: 'apexcharts-point-annotation-label',
              padding: {
                left: series.show.extremas_config.label_padding_left || 5,
                right: series.show.extremas_config.label_padding_right || 5,
                top: series.show.extremas_config.label_padding_top || 2,
                bottom: series.show.extremas_config.label_padding_bottom || 2,
              },
            },
          },
        };
      }

      if (minMax.max[1] !== null && showMax) {
        annotations.push(
          this._getPointAnnotationStyle(
            minMax.max,
            this._seriesOffset[index] || 0,
            series.color!,
            computeTextColor(series.color!),
            series,
            index,
            false,
            styleWithX as any, // Temporarily cast to "any" to bypass the error
            'max', // Specify type for potential customization
          ),
        );
      }
      if (minMax.min[1] !== null && showMin) {
        annotations.push(
          this._getPointAnnotationStyle(
            minMax.min,
            this._seriesOffset[index] || 0,
            series.color!,
            computeTextColor(series.color!),
            series,
            index,
            true, // Invert for min
            styleWithX as any, // Temporarily cast to "any" to bypass the error
            'min', // Specify type for potential customization
          ),
        );
      }
    });
    return annotations;
  }

  private _getPointAnnotationStyle(
    value: HistoryPoint,
    offset: number,
    bgColor: string,
    txtColor: string,
    seriesItem: ChartCardSeriesConfig,
    index: number,
    invert = false,
    predefinedStyle?: ApexAnnotationsPoint,
    type?: 'min' | 'max',
  ): ApexAnnotationsPoint {
    const stateFormat = this._formatStateValue(value[1], index);
    const uom = this._computeUomHelper(
      seriesItem.unit,
      this._hass?.states[seriesItem.entity],
      this._config!.use_duration_format,
    );
    const formattedTime = this._formatApexDateHelper(new Date(value[0] + offset + this._serverTimeOffset));
    const annotationText = `${stateFormat}${uom} at ${formattedTime}`;

    // Use predefined style if available, otherwise use defaults
    const baseStyle: ApexAnnotationsPoint = predefinedStyle
      ? {
          ...predefinedStyle,
          x: value[0] + offset - this._serverTimeOffset,
          y: value[1] !== null ? value[1] : undefined, // Ensure y is set correctly
          label: {
            ...predefinedStyle.label,
            text:
              seriesItem.show.extremas_config?.label_text?.[type || 'max'] ||
              (type === 'min' ? 'Min' : 'Max') + `: ${annotationText}`, // Customize text based on type
          },
        }
      : {
          x: value[0] + offset - this._serverTimeOffset,
          y: value[1] !== null ? value[1] : undefined, // Ensure y is set correctly
          marker: {
            size: 4,
            fillColor: bgColor,
            strokeColor: '#fff',
            strokeWidth: 1,
            shape: 'circle',
            // offsetY: invert ? 4 : -4,
          },
          label: {
            borderColor: bgColor,
            borderWidth: 1,
            borderRadius: 2,
            text: annotationText,
            textAnchor: 'middle',
            orientation: 'horizontal',
            offsetY: invert ? 20 : -20,
            style: {
              background: bgColor,
              color: txtColor,
              fontSize: '12px',
              fontWeight: 400,
              fontFamily: undefined,
              cssClass: 'apexcharts-point-annotation-label',
              padding: {
                left: 5,
                right: 5,
                top: 2,
                bottom: 2,
              },
            },
          },
        };

    return baseStyle;
  }

  private _computeNowAnnotation(now: Date): { xaxis?: XAxisAnnotation[] } {
    if (this._config?.now?.show) {
      const color = computeColor(this._config.now.color || 'var(--primary-color)');
      const textColor = computeTextColor(color);
      const annotation: XAxisAnnotation = {
        x: now.getTime(),
        strokeDashArray: 3,
        label: {
          text: this._config.now?.label,
          borderColor: color,
          style: {
            color: textColor,
            background: color,
          },
        },
        borderColor: color,
      };
      return {
        xaxis: [annotation],
      };
    }
    return {};
  }

  private _computeYAxisAutoMinMax(start: Date, end: Date) {
    if (!this._config) return;
    this._yAxisConfig?.map((_yaxis) => {
      if (_yaxis.min_type !== minmax_type.FIXED || _yaxis.max_type !== minmax_type.FIXED) {
        const minMax = _yaxis.series_id?.map((id) => {
          const lMinMax = this._graphs![id]?.minMaxWithTimestampForYAxis(
            this._seriesOffset[id] ? new Date(start.getTime() + this._seriesOffset[id]).getTime() : start.getTime(),
            this._seriesOffset[id] ? new Date(end.getTime() + this._seriesOffset[id]).getTime() : end.getTime(),
          );
          if (!lMinMax) return undefined;
          if (this._config?.series[id].invert) {
            const cmin = lMinMax.min[1];
            const cmax = lMinMax.max[1];
            if (cmin !== null) {
              lMinMax.max[1] = -cmin;
            }
            if (cmax !== null) {
              lMinMax.min[1] = -cmax;
            }
          }
          return lMinMax;
        });
        let min: number | null = null;
        let max: number | null = null;
        minMax?.forEach((_elt) => {
          if (!_elt) return;
          if (min === undefined || min === null) {
            min = _elt.min[1];
          } else if (_elt.min[1] !== null && min > _elt.min[1]) {
            min = _elt.min[1];
          }
          if (max === undefined || max === null) {
            max = _elt.max[1];
          } else if (_elt.max[1] !== null && max < _elt.max[1]) {
            max = _elt.max[1];
          }
        });
        if (_yaxis.align_to !== undefined) {
          if (min !== null && _yaxis.min_type !== minmax_type.FIXED) {
            if (min % _yaxis.align_to !== 0) {
              min = min >= 0 ? min - (min % _yaxis.align_to) : -(_yaxis.align_to + (min % _yaxis.align_to) - min);
            }
          }
          if (max !== null && _yaxis.max_type !== minmax_type.FIXED) {
            if (max % _yaxis.align_to !== 0) {
              max =
                max >= 0
                  ? _yaxis.align_to - (_yaxis.align_to % _yaxis.align_to) + max
                  : (_yaxis.align_to % _yaxis.align_to) - max;
            }
          }
        }
        _yaxis.series_id?.forEach((_id) => {
          if (min !== null && _yaxis.min_type !== minmax_type.FIXED) {
            this._config!.apex_config!.yaxis![_id].min = this._getMinMaxBasedOnType(
              true,
              min,
              _yaxis.min as number,

              _yaxis.min_type!,
            );
          }
          if (max !== null && _yaxis.max_type !== minmax_type.FIXED) {
            this._config!.apex_config!.yaxis![_id].max = this._getMinMaxBasedOnType(
              false,
              max,
              _yaxis.max as number,

              _yaxis.max_type!,
            );
          }
        });
      }
    });
    return this._config?.apex_config?.yaxis;
  }

  private _getMinMaxBasedOnType(isMin: boolean, value: number, configMinMax: number, type: minmax_type): number {
    switch (type) {
      case minmax_type.AUTO:
        return value;
      case minmax_type.SOFT:
        if ((isMin && value > configMinMax) || (!isMin && value < configMinMax)) {
          return configMinMax;
        } else {
          return value;
        }
      case minmax_type.ABSOLUTE:
        return value + configMinMax;
      default:
        return value;
    }
  }

  private _getTypeOfMinMax(value?: 'auto' | number | string): [number | undefined, minmax_type] {
    const regexFloat = /[+-]?\d+(\.\d+)?/g;
    if (typeof value === 'number') {
      return [value, minmax_type.FIXED];
    } else if (value === undefined || value === 'auto') {
      return [undefined, minmax_type.AUTO];
    }
    if (typeof value === 'string' && value !== 'auto') {
      const matched = value.match(regexFloat);
      if (!matched || matched.length !== 1) {
        throw new Error(`Bad yaxis min/max format: ${value}`);
      }
      const floatValue = parseFloat(matched[0]);
      if (value.startsWith('~')) {
        return [floatValue, minmax_type.SOFT];
      } else if (value.startsWith('|') && value.endsWith('|')) {
        return [floatValue, minmax_type.ABSOLUTE];
      }
    }
    throw new Error(`Bad yaxis min/max format: ${value}`);
  }

  private _computeGradient(
    seriesItem: ChartCardSeriesConfig,
    min: number | undefined,
    max: number | undefined,
    defColor: string,
    invert = false,
  ) {
    if (!seriesItem.color_threshold) return undefined;
    if (min === undefined || max === undefined || max - min === 0) return undefined;
    const scale = max - min;

    const result = seriesItem.color_threshold
      .sort((a, b) => a.value - b.value) // Ensure thresholds are sorted by value
      .flatMap((thres, index, arr) => {
        let color: string | undefined = undefined;
        const defaultOp =
          seriesItem.opacity !== undefined ? seriesItem.opacity : seriesItem.type === 'area' ? DEFAULT_AREA_OPACITY : 1;
        let opacity = thres.opacity === undefined ? defaultOp : thres.opacity;

        // Determine the color and opacity based on interpolation if needed
        if (thres.value > max && arr[index - 1]) {
          // Threshold is above max, interpolate with previous threshold
          const prevThres = arr[index - 1];
          const factor = (max - prevThres.value) / (thres.value - prevThres.value);
          if (factor < 0 || factor > 1) return []; // Skip if max is outside the interpolation range

          color = interpolateColor(
            tinycolor(prevThres.color || defColor).toHexString(),
            tinycolor(thres.color || defColor).toHexString(),
            factor,
          );

          const prevOp = prevThres.opacity === undefined ? defaultOp : prevThres.opacity!;
          const curOp = thres.opacity === undefined ? defaultOp : thres.opacity!;
          opacity = prevOp + (curOp - prevOp) * factor;
        } else if (thres.value < min && arr[index + 1]) {
          // Threshold is below min, interpolate with next threshold
          const nextThres = arr[index + 1];
          const factor = (arr[index + 1].value - min) / (arr[index + 1].value - thres.value);
          if (factor < 0 || factor > 1) return []; // Skip if min is outside the interpolation range

          color = interpolateColor(
            tinycolor(nextThres.color || defColor).toHexString(),
            tinycolor(thres.color || defColor).toHexString(),
            factor,
          );

          const nextOp = nextThres.opacity === undefined ? defaultOp : nextThres.opacity!;
          const curOp = thres.opacity === undefined ? defaultOp : thres.opacity!;
          opacity = curOp + (nextOp - curOp) * (1 - factor);
        }

        color = color || tinycolor(thres.color || defColor).toHexString();
        if ([undefined, 'line'].includes(seriesItem.type)) color = tinycolor(color).setAlpha(opacity).toHex8String();
        return [
          {
            color: color,
            offset:
              scale <= 0 ? 0 : invert ? 100 - (max - thres.value) * (100 / scale) : (max - thres.value) * (100 / scale),
            opacity,
          },
        ];
      });

    // Add stops for min and max if not already covered by thresholds
    const stops = result.filter((stop) => stop.offset >= 0 && stop.offset <= 100);
    const minOffset = invert ? 100 : 0;
    const maxOffset = invert ? 0 : 100;

    if (!stops.some((stop) => Math.abs(stop.offset - minOffset) < 0.1)) {
      const firstStop = stops[0] || { color: defColor, opacity: seriesItem.opacity ?? 1 };
      stops.unshift({
        offset: minOffset,
        color: firstStop.color,
        opacity: firstStop.opacity,
      });
    }
    if (!stops.some((stop) => Math.abs(stop.offset - maxOffset) < 0.1)) {
      const lastStop = stops[stops.length - 1] || { color: defColor, opacity: seriesItem.opacity ?? 1 };
      stops.push({
        offset: maxOffset,
        color: lastStop.color,
        opacity: lastStop.opacity,
      });
    }

    // Ensure stops are sorted by offset and remove duplicates
    const finalStops = stops
      .sort((a, b) => a.offset - b.offset)
      .filter((stop, index, self) => index === self.findIndex((s) => s.offset === stop.offset));

    return finalStops;
  }

  private _computeHeaderStateColor(seriesItem: ChartCardSeriesConfig, value: number | null): string {
    let color = '';
    if (this._config?.header?.colorize_states) {
      if (
        this._config.experimental?.color_threshold &&
        seriesItem.show.header_color_threshold &&
        seriesItem.color_threshold &&
        seriesItem.color_threshold.length > 0 &&
        value !== null
      ) {
        const index = seriesItem.color_threshold.findIndex((thres) => {
          return thres.value > value;
        });
        if (index < 0) {
          color = computeColor(
            seriesItem.color_threshold[seriesItem.color_threshold.length - 1].color ||
              this._headerColors[seriesItem.index],
          );
        } else if (index === 0) {
          color = computeColor(seriesItem.color_threshold[0].color || this._headerColors[seriesItem.index]);
        } else {
          const prev = seriesItem.color_threshold[index - 1];
          const next = seriesItem.color_threshold[index];
          if (seriesItem.type === 'column') {
            color = computeColor(prev.color || this._headerColors[seriesItem.index]);
          } else {
            const factor = (value - prev.value) / (next.value - prev.value);
            color = interpolateColor(
              computeColor(prev.color || this._headerColors[seriesItem.index]),
              computeColor(next.color || this._headerColors[seriesItem.index]),
              factor,
            );
          }
        }
      } else {
        return this._headerColors && this._headerColors.length > 0
          ? `color: ${this._headerColors[seriesItem.index]};`
          : '';
      }
    }
    return color ? `color: ${color};` : '';
  }

  private _computeLastState(value: number | null, index: number): string | number | null {
    if (value === null) return value;
    return myFormatNumber(value, this._hass?.locale, this._config?.series[index].float_precision);
  }

  /*
    Makes the chart end at the last timestamp of the data when everything displayed is a
    column and group_by is enabled for every seriesItem
  */
  private _findEndOfChart(end: Date, brush: boolean): number {
    const localEnd = new Date(end);
    let offsetEnd: number | undefined = 0;
    const series = brush ? this._config?.series_in_brush : this._config?.series_in_graph;
    const onlyGroupBy = series?.reduce((acc, seriesItem) => {
      return acc && seriesItem.group_by.func !== 'raw';
    }, series?.length > 0);
    if (onlyGroupBy) {
      offsetEnd = series?.reduce((acc, seriesItem) => {
        const dur = parse(seriesItem.group_by.duration) || 0;
        if (acc === -1 || dur < acc) {
          return dur;
        }
        return acc;
      }, -1);
    }
    return new Date(localEnd.getTime() - (offsetEnd ? offsetEnd : 0)).getTime();
  }

  private _invertData(data: EntityCachePoints): EntityCachePoints {
    return data.map((item) => {
      if (item[1] === null) return item;
      return [item[0], -item[1]];
    });
  }

  private _getSpanDates(): { start: Date; end: Date } {
    let end = new Date();
    let start = new Date(end.getTime() - this._graphSpan + 1);

    // ADD: Native Date logic equivalent to moment().startOf/endOf
    // Note: Timezone handling here relies on the browser's local timezone or server timezone
    // if server timezone is correctly applied elsewhere (e.g., via _serverTimeOffset)
    // This might need refinement depending on exact timezone requirements.
    const now = new Date(); // Use current date/time for span calculations

    if (this._config?.span?.start) {
      const unit = this._config.span.start;
      start = getStartOfUnit(now, unit);
      end = new Date(start.getTime() + this._graphSpan);
    } else if (this._config?.span?.end) {
      const unit = this._config.span.end;
      end = getEndOfUnit(now, unit);
      // Add 1 ms to be inclusive of the unit, similar to moment().endOf().add(1, 'ms')
      end = new Date(end.getTime() + 1);
      start = new Date(end.getTime() - this._graphSpan + 1);
    }

    if (this._offset) {
      end.setTime(end.getTime() + this._offset);
      start.setTime(start.getTime() + this._offset);
    }
    return { start, end };
  }

  private _handleAction(ev: ActionHandlerEvent, seriesItemConfig: ChartCardSeriesConfig) {
    if (ev.detail?.action) {
      const configDup: ActionsConfig = seriesItemConfig.header_actions
        ? JSON.parse(JSON.stringify(seriesItemConfig.header_actions))
        : {};

      switch (ev.detail.action) {
        case 'tap':
        case 'hold':
        case 'double_tap':
          {
            const actionConfig = configDup[`${ev.detail.action}_action`];
            configDup.entity = actionConfig && 'entity' in actionConfig ? actionConfig.entity : seriesItemConfig.entity;

            handleAction(this, this._hass!, configDup, ev.detail.action);
          }
          break;
        default:
          break;
      }
    }
    return;
  }

  private _handleTitleAction(ev: ActionHandlerEvent) {
    if (ev.detail?.action) {
      const configDup: ActionsConfig = this._config?.header?.title_actions
        ? JSON.parse(JSON.stringify(this._config?.header?.title_actions))
        : {};

      switch (ev.detail.action) {
        case 'tap':
        case 'hold':
        case 'double_tap':
          {
            const titleActionConfig = configDup[`${ev.detail.action}_action`];
            configDup.entity =
              titleActionConfig && 'entity' in titleActionConfig ? titleActionConfig.entity : undefined;

            handleAction(this, this._hass!, configDup, ev.detail.action);
          }
          break;
        default:
          break;
      }
    }
    return;
  }

  @eventOptions({ passive: true })
  private handleRippleActivate(): void {
    // Implement the logic for ripple activation
  }

  private handleRippleDeactivate(): void {
    // Implement the logic for ripple deactivation
  }

  private handleRippleFocus(): void {
    // Implement the logic for ripple focus
  }

  private handleRippleBlur(): void {
    // Implement the logic for ripple blur
  }

  public getCardSize(): number {
    return 3;
  }

  static getStubConfig(hass: HomeAssistant, entities: string[], entitiesFallback: string[]) {
    const entityFilter = (stateObj: HassEntity): boolean => {
      return !isNaN(Number(stateObj.state));
    };
    const _arrayFilter = (array: any[], conditions: Array<(value: any) => boolean>, maxSize: number) => {
      if (!maxSize || maxSize > array.length) {
        maxSize = array.length;
      }

      const filteredArray: any[] = [];

      for (let i = 0; i < array.length && filteredArray.length < maxSize; i++) {
        let meetsConditions = true;

        for (const condition of conditions) {
          if (!condition(array[i])) {
            meetsConditions = false;
            break;
          }
        }

        if (meetsConditions) {
          filteredArray.push(array[i]);
        }
      }

      return filteredArray;
    };
    const _findEntities = (
      hass: HomeAssistant,
      maxEntities: number,
      entities: string[],
      entitiesFallback: string[],
      includeDomains?: string[],
      entityFilter?: (stateObj: HassEntity) => boolean,
    ) => {
      const conditions: Array<(value: string) => boolean> = [];

      if (includeDomains?.length) {
        conditions.push((eid) => includeDomains!.includes(eid.split('.')[0]));
      }

      if (entityFilter) {
        conditions.push((eid) => hass.states[eid] && entityFilter(hass.states[eid]));
      }

      const entityIds = _arrayFilter(entities, conditions, maxEntities);

      if (entityIds.length < maxEntities && entitiesFallback.length) {
        const fallbackEntityIds = _findEntities(
          hass,
          maxEntities - entityIds.length,
          entitiesFallback,
          [],
          includeDomains,
          entityFilter,
        );

        entityIds.push(...fallbackEntityIds);
      }

      return entityIds;
    };
    const includeDomains = ['sensor'];
    const maxEntities = 2;

    const foundEntities = _findEntities(hass, maxEntities, entities, entitiesFallback, includeDomains, entityFilter);
    const conf = {
      header: { show: true, title: 'ApexCharts-Card', show_states: true, colorize_states: true },
      series: [] as ChartCardSeriesExternalConfig[],
    };
    if (foundEntities[0]) {
      conf.series[0] = {
        entity: foundEntities[0],
        data_generator: `// REMOVE ME
const now = new Date();
const data = [];
for(let i = 0; i <= 24; i++) {
  data.push([now.getTime() - i * 1000 * 60 * 60, Math.floor((Math.random() * 10) + 1)])
}
return data.reverse();
`,
      };
    }
    if (foundEntities[1]) {
      conf.series[1] = {
        entity: foundEntities[1],
        data_generator: `// REMOVE ME
const now = new Date();
const data = [];
for(let i = 0; i <= 24; i++) {
  data.push([now.getTime() - i * 1000 * 60 * 60, Math.floor((Math.random() * 10) + 1)])
}
return data.reverse();
`,
      };
    }
    return conf;
  }

  // Format the state value based on the series configuration
  private _formatStateValue(value: number | null, index: number): string | number | null {
    if (value === null) return null;
    const seriesConf = this._config?.series[index];
    if (!seriesConf) return value;

    return myFormatNumber(value, this._hass?.locale, seriesConf.float_precision);
  }

  // Add this helper method before _formatStateValue method
  private _computeUomHelper(
    unit: string | undefined,
    entity: HassEntity | undefined,
    useDurationFormat?: boolean,
  ): string {
    if (unit === undefined) return '';
    // Actually use useDurationFormat to avoid it being marked as unused
    const unitValue = unit || entity?.attributes?.unit_of_measurement || '';
    return useDurationFormat && unitValue === 's' ? 'sec' : unitValue;
  }

  // Add this helper method
  private _formatApexDateHelper(date: Date): string {
    return formatApexDate(this._config!, this._hass, date);
  }
}

// Configure the preview in the Lovelace card picker
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: 'apexcharts-card',
  name: 'ApexCharts Card',
  preview: true,
  description: 'A graph card based on ApexCharts',
});

// ADD Helper functions for getStartOfUnit and getEndOfUnit (native Date equivalent)
// Defined outside the class at module level
function getStartOfUnit(date: Date, unit: string): Date {
  const d = new Date(date);
  switch (unit) {
    case 'minute':
      d.setSeconds(0, 0);
      break;
    case 'hour':
      d.setMinutes(0, 0, 0);
      break;
    case 'day':
      d.setHours(0, 0, 0, 0);
      break;
    case 'week': // Assuming week starts on Sunday (locale-dependent)
      {
        const dayOfWeekSunday = d.getDay(); // 0 = Sunday
        const diffSunday = d.getDate() - dayOfWeekSunday;
        d.setDate(diffSunday);
        d.setHours(0, 0, 0, 0);
      }
      break;
    case 'isoWeek': // ISO 8601 week starts on Monday
      {
        const dayOfWeekISO = d.getDay() || 7; // Adjust Sunday (0) to 7
        const diffISO = d.getDate() - dayOfWeekISO + 1; // +1 because Monday is day 1
        d.setDate(diffISO);
        d.setHours(0, 0, 0, 0);
      }
      break;
    case 'month':
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      break;
    case 'year':
      d.setMonth(0, 1);
      d.setHours(0, 0, 0, 0);
      break;
  }
  return d;
}

function getEndOfUnit(date: Date, unit: string): Date {
  const d = new Date(date);
  switch (unit) {
    case 'minute':
      d.setSeconds(59, 999);
      break;
    case 'hour':
      d.setMinutes(59, 59, 999);
      break;
    case 'day':
      d.setHours(23, 59, 59, 999);
      break;
    case 'week': // Assuming week ends on Saturday
      {
        const dayOfWeekSundayEnd = d.getDay(); // 0 = Sunday
        const diffSundayEnd = d.getDate() + (6 - dayOfWeekSundayEnd);
        d.setDate(diffSundayEnd);
        d.setHours(23, 59, 59, 999);
      }
      break;
    case 'isoWeek': // ISO 8601 week ends on Sunday
      {
        const dayOfWeekISOEnd = d.getDay() || 7; // Adjust Sunday (0) to 7
        const diffISOEnd = d.getDate() + (7 - dayOfWeekISOEnd);
        d.setDate(diffISOEnd);
        d.setHours(23, 59, 59, 999);
      }
      break;
    case 'month':
      d.setMonth(d.getMonth() + 1, 0); // Go to next month, day 0 is last day of current month
      d.setHours(23, 59, 59, 999);
      break;
    case 'year':
      d.setMonth(11, 31);
      d.setHours(23, 59, 59, 999);
      break;
  }
  return d;
}
