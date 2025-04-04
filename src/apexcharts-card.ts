import { LitElement, html, TemplateResult, PropertyValues, CSSResultGroup } from 'lit';
import { property, customElement, eventOptions } from 'lit/decorators.js';
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
import { handleAction, HomeAssistant, ActionHandlerEvent } from 'custom-card-helpers';
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
} from './types-config';
import exportedTypeSuite from './types-config-ti';
import {
  DEFAULT_AREA_OPACITY,
  DEFAULT_FILL_RAW,
  DEFAULT_FLOAT_PRECISION,
  DEFAULT_SHOW_IN_CHART,
  DEFAULT_SHOW_IN_HEADER,
  DEFAULT_SHOW_IN_LEGEND,
  DEFAULT_SHOW_LEGEND_VALUE,
  DEFAULT_SHOW_NAME_IN_HEADER,
  DEFAULT_SHOW_OFFSET_IN_NAME,
  DEFAULT_UPDATE_DELAY,
  NO_VALUE,
  PLAIN_COLOR_TYPES,
  TIMESERIES_TYPES,
} from './const';
import {
  DEFAULT_COLORS,
  DEFAULT_DURATION,
  DEFAULT_FUNC,
  DEFAULT_GROUP_BY_FILL,
  DEFAULT_GRAPH_SPAN,
  DEFAULT_SERIES_TYPE,
  HOUR_24,
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

  private _entities: HassEntity[] = [];

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

  private _updateDelay: number = DEFAULT_UPDATE_DELAY;

  private _brushInit = false;

  private _brushSelectionSpan = 0;

  private _yAxisConfig?: ChartCardYAxis[];

  private _serverTimeOffset = 0;

  @property({ attribute: false }) _lastUpdated: Date = new Date();

  @property({ type: Boolean }) private _warning = false;

  // ADD: Use our new DebouncedFunction type
  private _debouncedUpdateData: DebouncedFunction = debounce(() => this._updateData(), 500); // Debounce for 500ms
  // END ADD

  public connectedCallback() {
    super.connectedCallback();
    if (this._config && this._hass && !this._loaded) {
      this._initialLoad();
    } else if (this._config && this._hass && this._apexChart && !this._config.update_interval) {
      window.requestAnimationFrame(() => {
        this._updateOnInterval();
      });
    }
    if (this._config?.update_interval) {
      window.requestAnimationFrame(() => {
        this._updateOnInterval();
      });
      // Valid because setConfig has been done.

      this._intervalTimeout = setInterval(() => this._updateOnInterval(), this._interval!);
    }
  }

  disconnectedCallback() {
    if (this._intervalTimeout) {
      clearInterval(this._intervalTimeout);
      this._intervalTimeout = undefined; // ADD: Clear reference
    }
    // ADD: Clear any pending debounced updates on disconnect
    if (this._debouncedUpdateData.cancel) {
      this._debouncedUpdateData.cancel(); // Assumes a cancel method if using a library
    }
    // END ADD
    this._updating = false;
    super.disconnectedCallback();
  }

  private _updateOnInterval(): void {
    if (!this._updating && this._hass) {
      // Use debounced update
      // this._updating = true; // Set updating flag inside _updateData now
      // this._updateData();
      this._debouncedUpdateData(); // ADD
    }
  }

  protected updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    if (this._config && this._hass && this.isConnected && !this._loaded) {
      this._initialLoad();
    }
  }

  private _firstDataLoad() {
    if (this._updating || this._dataLoaded || !this._apexChart || !this._config || !this._hass) return;
    this._dataLoaded = true;
    this._updating = true;
    this._updateData().then(() => {
      if (this._config?.experimental?.hidden_by_default) {
        this._config.series_in_graph.forEach((seriesItem, _index) => {
          if (seriesItem.show.hidden_by_default) {
            const name = computeName(_index, this._config?.series_in_graph, this._entities);
            this._apexChart?.hideSeries(name);
          }
        });
      }
    });
  }

  public set hass(hass: HomeAssistant) {
    this._hass = hass;
    if (!this._config || !this._graphs || !hass) return;

    this._graphs.map((graph) => {
      if (graph) graph.hass = hass;
    });

    let updated = false;
    let rawHeaderStatesUpdated = false;
    this._config.series.forEach((seriesItem, _index) => {
      const entityState = (hass && hass.states[seriesItem.entity]) || undefined;
      if (!entityState) {
        this._entities[_index] = entityState;
      } else if (entityState && this._entities[_index] !== entityState) {
        this._entities[_index] = entityState;
        updated = true;
        if (this._graphs && this._graphs[_index]) {
          this._graphs[_index]!.hass = this._hass!;
        }
        if (seriesItem.show.in_header === 'raw') {
          this._headerState[_index] = truncateFloat(
            seriesItem.attribute ? entityState.attributes[seriesItem.attribute] : entityState.state,
            seriesItem.float_precision,
          ) as number;
          rawHeaderStatesUpdated = true;
        }
      }
    });
    if (rawHeaderStatesUpdated) {
      this._headerState = [...this._headerState];
    }
    if (this._config.series.some((_, index) => this._entities[index] === undefined)) {
      this._warning = true;
      return;
    } else if (this._warning) {
      this._warning = false;
      this._reset();
    }
    if (updated) {
      this._entities = [...this._entities];
      if (!this._updating && !this._config.update_interval) {
        if (!this._dataLoaded) {
          this._firstDataLoad();
        } else {
          // ADD: Use debounced update, incorporating update_delay
          // Use a slightly longer debounce time if update_delay is significant
          const debounceTime = Math.max(500, this._updateDelay || 0);
          // Recreate debounced function if delay changed? For now, use fixed debounce or max(500, delay)
          if (!this._debouncedUpdateData || this._debouncedUpdateData.waitFor !== debounceTime) {
            this._debouncedUpdateData = debounce(() => this._updateData(), debounceTime);
          }
          this._debouncedUpdateData();
          // END ADD
        }
      }
    }
  }

  private _reset() {
    if (this._apexChart) {
      this._apexChart.destroy();
      this._apexChart = undefined;
      this._loaded = false;
      this._dataLoaded = false;
      this._updating = false;
      this._serverTimeOffset = 0;
      if (this._apexBrush) {
        this._apexBrush.destroy();
        this._apexBrush = undefined;
        this._brushInit = false;
      }
    }
    if (this._config && this._hass && !this._loaded) {
      this._initialLoad();
    }
  }

  public setConfig(config: ChartCardExternalConfig) {
    let configDup: ChartCardExternalConfig = JSON.parse(JSON.stringify(config));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((configDup as any).entities) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      configDup.series = (configDup as any).entities;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (configDup as any).entities;
    }
    configDup = configDup as ChartCardExternalConfig;
    if (configDup.config_templates) {
      configDup.config_templates =
        configDup.config_templates && Array.isArray(configDup.config_templates)
          ? configDup.config_templates
          : [configDup.config_templates];
      configDup = mergeConfigTemplates(getLovelace(), configDup);
    }
    try {
      const { ChartCardExternalConfig } = createCheckers(exportedTypeSuite);
      if (!configDup.experimental?.disable_config_validation) {
        ChartCardExternalConfig.strictCheck(configDup);
      }
      if (configDup.all_series_config) {
        configDup.series.forEach((seriesItem, _index) => {
          const allDup = JSON.parse(JSON.stringify(configDup.all_series_config));
          configDup.series[_index] = mergeDeepConfig(allDup, seriesItem);
        });
      }
      if (configDup.update_interval) {
        this._interval = validateInterval(configDup.update_interval, 'update_interval');
      }
      if (configDup.graph_span) {
        this._graphSpan = validateInterval(configDup.graph_span, 'graph_span');
      }
      if (configDup.span?.offset) {
        this._offset = validateOffset(configDup.span.offset, 'span.offset');
      }
      if (configDup.span?.end && configDup.span?.start) {
        throw new Error(`span: Only one of 'start' or 'end' is allowed.`);
      }
      if (configDup.brush?.selection_span) {
        this._brushSelectionSpan = validateInterval(configDup.brush.selection_span, 'brush.selection_span');
      }
      configDup.series.forEach((seriesItem, _index) => {
        if (seriesItem.offset) {
          this._seriesOffset[_index] = validateOffset(seriesItem.offset, `series[${_index}].offset`);
        }
        if (seriesItem.time_delta) {
          this._seriesTimeDelta[_index] = validateOffset(seriesItem.time_delta, `series[${_index}].time_delta`);
        }
      });
      if (configDup.update_delay) {
        this._updateDelay = validateInterval(configDup.update_delay, `update_delay`);
      }

      this._config = mergeDeep(
        {
          graph_span: DEFAULT_GRAPH_SPAN,
          cache: true,
          useCompress: false,
          show: { loading: true },
        },
        configDup,
      );

      // ADD: Comment regarding cache compression
      // Note on `useCompress`: Compression (lz-string) can reduce storage size for large datasets
      // but adds overhead for compression/decompression. Evaluate based on typical data size.
      // It's disabled by default.
      // END ADD

      const defColors = this._config?.color_list || DEFAULT_COLORS;
      if (this._config) {
        this._graphs = this._config.series.map((seriesItem, _index) => {
          seriesItem.index = _index;
          seriesItem.ignore_history = !!(
            this._config?.chart_type &&
            ['donut', 'pie', 'radialBar'].includes(this._config?.chart_type) &&
            (!seriesItem.group_by || seriesItem.group_by?.func === 'raw') &&
            !seriesItem.data_generator &&
            !seriesItem.statistics &&
            !seriesItem.offset
          );
          if (!this._headerColors[_index]) {
            this._headerColors[_index] = defColors[_index % defColors.length];
          }
          if (seriesItem.color) {
            this._headerColors[_index] = seriesItem.color;
          }
          seriesItem.fill_raw = seriesItem.fill_raw || DEFAULT_FILL_RAW;
          seriesItem.extend_to = seriesItem.extend_to !== undefined ? seriesItem.extend_to : 'end';
          seriesItem.type = this._config?.chart_type ? undefined : seriesItem.type || DEFAULT_SERIES_TYPE;
          if (!seriesItem.group_by) {
            seriesItem.group_by = { duration: DEFAULT_DURATION, func: DEFAULT_FUNC, fill: DEFAULT_GROUP_BY_FILL };
          } else {
            seriesItem.group_by.duration = seriesItem.group_by.duration || DEFAULT_DURATION;
            seriesItem.group_by.func = seriesItem.group_by.func || DEFAULT_FUNC;
            seriesItem.group_by.fill = seriesItem.group_by.fill || DEFAULT_GROUP_BY_FILL;
          }
          if (!seriesItem.show) {
            seriesItem.show = {
              in_legend: DEFAULT_SHOW_IN_LEGEND,
              legend_value: DEFAULT_SHOW_LEGEND_VALUE,
              in_header: DEFAULT_SHOW_IN_HEADER,
              in_chart: DEFAULT_SHOW_IN_CHART,
              name_in_header: DEFAULT_SHOW_NAME_IN_HEADER,
              offset_in_name: DEFAULT_SHOW_OFFSET_IN_NAME,
            };
          } else {
            seriesItem.show.in_legend =
              seriesItem.show.in_legend === undefined ? DEFAULT_SHOW_IN_LEGEND : seriesItem.show.in_legend;
            seriesItem.show.legend_value =
              seriesItem.show.legend_value === undefined ? DEFAULT_SHOW_LEGEND_VALUE : seriesItem.show.legend_value;
            seriesItem.show.in_chart =
              seriesItem.show.in_chart === undefined ? DEFAULT_SHOW_IN_CHART : seriesItem.show.in_chart;
            seriesItem.show.in_header =
              seriesItem.show.in_header === undefined
                ? !seriesItem.show.in_chart && seriesItem.show.in_brush
                  ? false
                  : DEFAULT_SHOW_IN_HEADER
                : seriesItem.show.in_header;
            seriesItem.show.name_in_header =
              seriesItem.show.name_in_header === undefined
                ? DEFAULT_SHOW_NAME_IN_HEADER
                : seriesItem.show.name_in_header;
            seriesItem.show.offset_in_name =
              seriesItem.show.offset_in_name === undefined
                ? DEFAULT_SHOW_OFFSET_IN_NAME
                : seriesItem.show.offset_in_name;
          }
          validateInterval(seriesItem.group_by.duration, `series[${_index}].group_by.duration`);
          if (seriesItem.color_threshold && seriesItem.color_threshold.length > 0) {
            const sorted: ChartCardColorThreshold[] = JSON.parse(JSON.stringify(seriesItem.color_threshold));
            sorted.sort((a, b) => (a.value < b.value ? -1 : 1));
            seriesItem.color_threshold = sorted;
          }

          if (seriesItem.entity) {
            const editMode = getLovelace()?.editMode;
            // disable caching for editor

            const caching = editMode === true ? false : this._config!.cache;
            const graphEntry = new GraphEntry(
              _index,

              this._graphSpan!,

              caching,
              seriesItem,
              this._config?.span,
            );
            if (this._hass) graphEntry.hass = this._hass;
            return graphEntry;
          }
          return undefined;
        });
        this._config.series_in_graph = [];
        this._config.series_in_brush = [];
        this._config.series.forEach((seriesItem, _index) => {
          if (seriesItem.show.in_chart) {
            this._colors.push(this._headerColors[_index]);

            this._config!.series_in_graph.push(seriesItem);
          }
          if (this._config?.experimental?.brush && seriesItem.show.in_brush) {
            this._brushColors.push(this._headerColors[_index]);

            this._config!.series_in_brush.push(seriesItem);
          }
        });
        if (this._config.yaxis && this._config.yaxis.length > 1) {
          if (
            this._config.series_in_graph.some((seriesItem) => {
              return !seriesItem.yaxis_id;
            })
          ) {
            throw new Error(`Multiple yaxis detected: Some series are missing the 'yaxis_id' configuration.`);
          }
          if (
            this._config.yaxis.some((yaxis) => {
              return !yaxis.id;
            })
          ) {
            throw new Error(`Multiple yaxis detected: Some yaxis are missing an 'id'.`);
          }
        }
        if (this._config.yaxis) {
          const yAxisConfig = this._generateYAxisConfig(this._config);
          if (this._config.apex_config) {
            this._config.apex_config.yaxis = yAxisConfig;
          } else {
            this._config.apex_config = {
              yaxis: yAxisConfig,
            };
          }
          this._yAxisConfig?.forEach((_yaxis) => {
            [_yaxis.min, _yaxis.min_type] = this._getTypeOfMinMax(_yaxis.min);
            [_yaxis.max, _yaxis.max_type] = this._getTypeOfMinMax(_yaxis.max);
          });
        }
        this._headerColors = this._headerColors.slice(0, this._config?.series.length);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new Error(`/// apexcharts-card version ${pjson.version} /// ${e.message}`);
    }
    // Full reset only happens in editor mode
    this._reset();
  }

  private _generateYAxisConfig(config: ChartCardConfig): ApexYAxis[] | undefined {
    if (!config.yaxis) return undefined;
    const burned: boolean[] = [];
    this._yAxisConfig = JSON.parse(JSON.stringify(config.yaxis));
    const yaxisConfig: ApexYAxis[] = config.series_in_graph.map((seriesItem, seriesIndex) => {
      let idx = -1;
      if (config.yaxis?.length !== 1) {
        idx = config.yaxis!.findIndex((yaxis) => {
          return yaxis.id === seriesItem.yaxis_id;
        });
      } else {
        idx = 0;
      }
      if (idx < 0) {
        throw new Error(`yaxis_id: ${seriesItem.yaxis_id} doesn't exist.`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let yAxisDup: any = JSON.parse(JSON.stringify(config.yaxis![idx]));
      delete yAxisDup.apex_config;
      delete yAxisDup.decimals;
      yAxisDup.decimalsInFloat =
        config.yaxis![idx].decimals === undefined ? DEFAULT_FLOAT_PRECISION : config.yaxis![idx].decimals;
      if (this._yAxisConfig?.[idx].series_id) {
        this._yAxisConfig?.[idx].series_id?.push(seriesIndex);
      } else {
        this._yAxisConfig![idx].series_id! = [seriesIndex];
      }

      if (config.yaxis![idx].apex_config) {
        yAxisDup = mergeDeep(yAxisDup, config.yaxis![idx].apex_config);
        delete yAxisDup.apex_config;
      }
      if (typeof yAxisDup.min !== 'number') delete yAxisDup.min;
      if (typeof yAxisDup.max !== 'number') delete yAxisDup.max;
      if (burned[idx]) {
        yAxisDup.show = false;
      } else {
        yAxisDup.show = config.yaxis![idx].show === undefined ? true : config.yaxis![idx].show;
        burned[idx] = true;
      }
      return yAxisDup;
    });
    return yaxisConfig;
  }

  static get styles(): CSSResultGroup {
    return stylesApex;
  }

  protected render(): TemplateResult {
    if (!this._config || !this._hass) return html``;
    if (this._warning || this._config.series.some((_, index) => this._entities[index] === undefined)) {
      return this._renderWarnings();
    }

    const spinnerClass: ClassInfo = {
      'lds-ring': this._config.show?.loading && this._updating ? true : false,
    };
    const wrapperClasses: ClassInfo = {
      wrapper: true,
      'with-header': this._config.header?.show || true,
    };

    const standardHeaderTitle = this._config.header?.standard_format ? this._config.header?.title : undefined;

    return html`
      <ha-card header=${ifDefined(standardHeaderTitle)}>
        <div id="spinner-wrapper">
          <div id="spinner" class=${classMap(spinnerClass)}>
            <div></div>
            <div></div>
            <div></div>
            <div></div>
          </div>
        </div>
        <div class=${classMap(wrapperClasses)}>
          ${this._config.header?.show && (this._config.header.show_states || !this._config.header.standard_format)
            ? this._renderHeader()
            : html``}
          <div id="graph-wrapper">
            <div id="graph"></div>
            ${this._config.series_in_brush.length ? html`<div id="brush"></div>` : ``}
          </div>
        </div>
        ${this._renderLastUpdated()}
      </ha-card>
    `;
  }

  private _renderWarnings(): TemplateResult {
    return html`
      <ha-card class="warning">
        <hui-warning>
          <div style="font-weight: bold;">apexcharts-card</div>
          ${this._config?.series.map((_, index) =>
            !this._entities[index]
              ? html` <div>Entity not available: ${this._config?.series[index].entity}</div> `
              : html``,
          )}
        </hui-warning>
      </ha-card>
    `;
  }

  private _renderHeader(): TemplateResult {
    const classes: ClassInfo = {
      floating: this._config?.header?.floating || false,
    };
    return html`
      <div id="header" class=${classMap(classes)}>
        ${!this._config?.header?.standard_format && this._config?.header?.title ? this._renderTitle() : html``}
        ${this._config?.header?.show_states ? this._renderStates() : html``}
      </div>
    `;
  }

  private _renderTitle(): TemplateResult {
    const classes =
      this._config?.header?.disable_actions ||
      !this._config?.header?.title_actions ||
      (this._config?.header?.title_actions?.tap_action?.action === 'none' &&
        (!this._config?.header?.title_actions?.hold_action?.action ||
          this._config?.header?.title_actions?.hold_action?.action === 'none') &&
        (!this._config?.header?.title_actions?.double_tap_action?.action ||
          this._config?.header?.title_actions?.double_tap_action?.action === 'none'))
        ? 'disabled'
        : 'actions';

    return html`<div
      id="header__title"
      class="${classes}"
      @action=${(ev: ActionHandlerEvent) => {
        this._handleTitleAction(ev);
      }}
      .actionHandler=${actionHandler({
        hasDoubleClick:
          this._config?.header?.title_actions?.double_tap_action?.action &&
          this._config?.header?.title_actions.double_tap_action.action !== 'none',
        hasHold:
          this._config?.header?.title_actions?.hold_action?.action &&
          this._config?.header?.title_actions?.hold_action.action !== 'none',
      })}
      @focus="${() => {
        this.handleRippleFocus();
      }}"
      @blur="${() => {
        this.handleRippleBlur();
      }}"
      @mousedown="${() => {
        this.handleRippleActivate();
      }}"
      @mouseup="${() => {
        this.handleRippleDeactivate();
      }}"
      @touchstart="${() => {
        this.handleRippleActivate();
      }}"
      @touchend="${() => {
        this.handleRippleDeactivate();
      }}"
      @touchcancel="${() => {
        this.handleRippleDeactivate();
      }}"
    >
      <span>${this._config?.header?.title}</span>
      <mwc-ripple unbounded id="ripple-title"></mwc-ripple>
    </div>`;
  }

  private _renderStates(): TemplateResult {
    return html`
      <div id="header__states">
        ${this._config?.series.map((seriesItem, index) => {
          if (seriesItem.show.in_header) {
            return html`
              <div
                id="states__state"
                class="${this._config?.header?.disable_actions ||
                (seriesItem.header_actions?.tap_action?.action === 'none' &&
                  (!seriesItem.header_actions?.hold_action?.action ||
                    seriesItem.header_actions?.hold_action?.action === 'none') &&
                  (!seriesItem.header_actions?.double_tap_action?.action ||
                    seriesItem.header_actions?.double_tap_action?.action === 'none'))
                  ? 'disabled'
                  : 'actions'}"
                @action=${(ev: ActionHandlerEvent) => {
                  this._handleAction(ev, seriesItem);
                }}
                .actionHandler=${actionHandler({
                  hasDoubleClick:
                    seriesItem.header_actions?.double_tap_action?.action &&
                    seriesItem.header_actions.double_tap_action.action !== 'none',
                  hasHold:
                    seriesItem.header_actions?.hold_action?.action &&
                    seriesItem.header_actions?.hold_action.action !== 'none',
                })}
                @focus="${() => {
                  this.handleRippleFocus();
                }}"
                @blur="${() => {
                  this.handleRippleBlur();
                }}"
                @mousedown="${() => {
                  this.handleRippleActivate();
                }}"
                @mouseup="${() => {
                  this.handleRippleDeactivate();
                }}"
                @touchstart="${() => {
                  this.handleRippleActivate();
                }}"
                @touchend="${() => {
                  this.handleRippleDeactivate();
                }}"
                @touchcancel="${() => {
                  this.handleRippleDeactivate();
                }}"
              >
                <div id="state__value">
                  <span id="state" style="${this._computeHeaderStateColor(seriesItem, this._headerState?.[index])}"
                    >${this._headerState?.[index] === 0
                      ? 0
                      : seriesItem.show.as_duration
                        ? prettyPrintTime(this._headerState?.[index], seriesItem.show.as_duration)
                        : this._computeLastState(this._headerState?.[index], index) || NO_VALUE}</span
                  >
                  ${!seriesItem.show.as_duration
                    ? html`<span id="uom">${computeUom(index, this._config?.series, this._entities)}</span>`
                    : ''}
                </div>
                ${seriesItem.show.name_in_header
                  ? html`<div id="state__name">${computeName(index, this._config?.series, this._entities)}</div>`
                  : ''}
                <mwc-ripple unbounded id="ripple-${index}"></mwc-ripple>
              </div>
            `;
          } else {
            return html``;
          }
        })}
      </div>
    `;
  }

  private _renderLastUpdated(): TemplateResult {
    if (this._config?.show?.last_updated) {
      return html` <div id="last_updated">${formatApexDate(this._config, this._hass, this._lastUpdated, true)}</div> `;
    }
    return html``;
  }

  private async _initialLoad() {
    await this.updateComplete;

    if (isUsingServerTimezone(this._hass)) {
      this._serverTimeOffset = computeTimezoneDiffWithLocal(this._hass?.config.time_zone);
    }

    if (!this._apexChart && this.shadowRoot && this._config && this.shadowRoot.querySelector('#graph')) {
      this._loaded = true;
      const graph = this.shadowRoot.querySelector('#graph');
      const layout = getLayoutConfig(this._config, this._hass, this._graphs);
      if (this._config.series_in_brush.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (layout as any).chart.id = Math.random().toString(36).substring(7);
      }
      this._apexChart = new ApexCharts(graph, layout);
      this._apexChart.render();
      if (this._config.series_in_brush.length) {
        const brush = this.shadowRoot.querySelector('#brush');
        this._apexBrush = new ApexCharts(
          brush,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getBrushLayoutConfig(this._config, this._hass, (layout as any).chart.id),
        );
        this._apexBrush.render();
      }
      this._firstDataLoad();
    }
  }

  private async _updateData() {
    // ADD: Set updating flag at the start of the actual update logic
    if (this._updating) return; // Prevent concurrent updates
    this._updating = true;
    // END ADD

    if (!this._config || !this._apexChart || !this._graphs) {
      this._updating = false; // Reset flag if we return early
      return;
    }

    const { start, end } = this._getSpanDates();
    const now = new Date();
    this._lastUpdated = now;
    const editMode = getLovelace()?.editMode;

    const caching = editMode === true ? false : this._config!.cache;
    try {
      const promise = this._graphs.map((graph, index) => {
        if (graph) graph.cache = caching;
        return graph?._updateHistory(
          this._seriesOffset[index] ? new Date(start.getTime() + this._seriesOffset[index]) : start,
          this._seriesOffset[index] ? new Date(end.getTime() + this._seriesOffset[index]) : end,
        );
      });
      await Promise.all(promise);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let graphData: any = { series: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const brushData: any = { series: [] };
      if (TIMESERIES_TYPES.includes(this._config.chart_type)) {
        this._graphs.forEach((graph, index) => {
          if (!graph) return [];
          const inHeader = this._config?.series[index].show.in_header;
          if (inHeader && inHeader !== 'raw') {
            if (inHeader === 'after_now' || inHeader === 'before_now') {
              // before_now / after_now
              this._headerState[index] = graph.nowValue(
                now.getTime() + (this._seriesOffset[index] ? this._seriesOffset[index] : 0),
                inHeader === 'before_now',
              );
            } else {
              // not raw
              this._headerState[index] = graph.lastState;
            }
          }
          if (!this._config?.series[index].show.in_chart && !this._config?.series[index].show.in_brush) {
            return;
          }
          if (graph.history.length === 0) {
            if (this._config?.series[index].show.in_chart) graphData.series.push({ data: [] });
            if (this._config?.series[index].show.in_brush) brushData.series.push({ data: [] });
            return;
          }
          let data: EntityCachePoints = [];
          const offset =
            this._serverTimeOffset + (this._seriesOffset[index] || 0) - (this._seriesTimeDelta[index] || 0);
          if (offset) {
            data = offsetData(graph.history, offset);
          } else {
            data = [...graph.history];
          }
          if (this._config?.series[index].type !== 'column' && this._config?.series[index].extend_to) {
            const lastPoint = data.slice(-1)[0]!;
            if (
              this._config?.series[index].extend_to === 'end' &&
              lastPoint[0] < end.getTime() - this._serverTimeOffset
            ) {
              data.push([end.getTime() - this._serverTimeOffset, lastPoint[1]]);
            } else if (
              this._config?.series[index].extend_to === 'now' &&
              lastPoint[0] < now.getTime() - this._serverTimeOffset
            ) {
              data.push([now.getTime() - this._serverTimeOffset, lastPoint[1]]);
            }
          }
          const result = this._config?.series[index].invert ? { data: this._invertData(data) } : { data };
          if (this._config?.series[index].show.in_chart) graphData.series.push(result);
          if (this._config?.series[index].show.in_brush) brushData.series.push(result);
          return;
        });
        graphData.annotations = this._computeAnnotations(start, end, new Date(now.getTime() - this._serverTimeOffset));
        if (this._yAxisConfig) {
          graphData.yaxis = this._computeYAxisAutoMinMax(start, end);
        }
        if (!this._apexBrush) {
          graphData.xaxis = {
            min: start.getTime() - this._serverTimeOffset,
            max: this._findEndOfChart(new Date(end.getTime() - this._serverTimeOffset), false),
          };
        }
      } else {
        // No timeline charts
        graphData = {
          series: this._graphs.flatMap((graph, index) => {
            if (!graph) return [];
            let data = 0;
            if (graph.history.length === 0) {
              if (this._config?.series[index].show.in_header !== 'raw') {
                this._headerState[index] = null;
              }
              data = 0;
            } else {
              const lastState = graph.lastState;
              data = lastState || 0;
              if (this._config?.series[index].show.in_header !== 'raw') {
                this._headerState[index] = lastState;
              }
            }
            if (!this._config?.series[index].show.in_chart) {
              return [];
            }
            if (this._config?.chart_type === 'radialBar') {
              return [getPercentFromValue(data, this._config.series[index].min, this._config.series[index].max)];
            } else {
              return [data];
            }
          }),
        };
      }
      graphData.colors = this._computeChartColors(false);
      if (this._apexBrush) {
        brushData.colors = this._computeChartColors(true);
      }
      if (
        this._config.experimental?.color_threshold &&
        this._config.series.some((seriesItem) => seriesItem.color_threshold)
      ) {
        graphData.markers = {
          colors: computeColors(
            this._config.series_in_graph.flatMap((seriesItem, index) => {
              if (seriesItem.type === 'column') return [];
              return [this._colors[index]];
            }),
          ),
        };
        // graphData.fill = { colors: graphData.colors };
        graphData.legend = { markers: { fillColors: computeColors(this._colors) } };
        graphData.tooltip = { marker: { fillColors: graphData.legend.markers.fillColors } };
        graphData.fill = {
          gradient: {
            type: 'vertical',
            colorStops: this._config.series_in_graph.map((seriesItem, index) => {
              if (!seriesItem.color_threshold || ![undefined, 'area', 'line'].includes(seriesItem.type)) return [];
              const min = this._graphs?.[seriesItem.index]?.min;
              const max = this._graphs?.[seriesItem.index]?.max;
              if (min === undefined || max === undefined) return [];
              return (
                this._computeFillColorStops(
                  seriesItem,
                  min,
                  max,
                  computeColor(this._colors[index]),
                  seriesItem.invert,
                ) || []
              );
            }),
          },
        };
        if (this._apexBrush) {
          brushData.fill = {
            gradient: {
              type: 'vertical',
              colorStops: this._config.series_in_brush.map((seriesItem, index) => {
                if (!seriesItem.color_threshold || ![undefined, 'area', 'line'].includes(seriesItem.type)) return [];
                const min = this._graphs?.[seriesItem.index]?.min;
                const max = this._graphs?.[seriesItem.index]?.max;
                if (min === undefined || max === undefined) return [];
                return (
                  this._computeFillColorStops(
                    seriesItem,
                    min,
                    max,
                    computeColor(this._colors[index]),
                    seriesItem.invert,
                  ) || []
                );
              }),
            },
          };
        }
      }
      // graphData.tooltip = { marker: { fillColors: ['#ff0000', '#00ff00'] } };
      const brushIsAtEnd =
        this._apexBrush &&
        this._brushInit &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this._apexChart as any).axes?.w?.globals?.maxX === (this._apexBrush as any).axes?.w?.globals?.maxX;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentMin = (this._apexChart as any).axes?.w?.globals?.minX;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentMax = (this._apexChart as any).axes?.w?.globals?.maxX;
      this._headerState = [...this._headerState];
      this._apexChart?.updateOptions(
        graphData,
        false,
        TIMESERIES_TYPES.includes(this._config.chart_type) ? false : true,
      );
      if (this._apexBrush) {
        const newMin = start.getTime() - this._serverTimeOffset;
        const newMax = this._findEndOfChart(new Date(end.getTime() - this._serverTimeOffset), false);
        brushData.xaxis = {
          min: newMin,
          max: newMax,
        };
        if (brushIsAtEnd || !this._brushInit) {
          brushData.chart = {
            selection: {
              enabled: true,
              xaxis: {
                min: brushData.xaxis.max - (this._brushSelectionSpan ? this._brushSelectionSpan : this._graphSpan / 4),
                max: brushData.xaxis.max,
              },
            },
          };
        } else {
          brushData.chart = {
            selection: {
              enabled: true,
              xaxis: {
                min: currentMin < newMin ? newMin : currentMin,
                max: currentMin < newMin ? newMin + (currentMax - currentMin) : currentMax,
              },
            },
          };
        }
        const selectionColor = computeColor('var(--primary-text-color)');
        brushData.chart.selection.stroke = { color: selectionColor };
        brushData.chart.selection.fill = { color: selectionColor, opacity: 0.1 };
        this._brushInit = true;
        this._apexBrush?.updateOptions(brushData, false, false);
      }
    } catch (err) {
      log(err);
    }
    // Reset updating flag at the end
    this._updating = false;
  }

  private _computeAnnotations(start: Date, end: Date, now: Date) {
    return {
      ...this._computeMinMaxPointsAnnotations(start, end),
      ...this._computeNowAnnotation(now),
    };
  }

  private _computeMinMaxPointsAnnotations(start: Date, end: Date) {
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
    return {
      points: this._config?.series_in_graph.flatMap((seriesItem, index) => {
        if (seriesItem.show.extremas) {
          const { min, max } = this._graphs?.[seriesItem.index]?.minMaxWithTimestamp(
            this._seriesOffset[seriesItem.index]
              ? new Date(start.getTime() + this._seriesOffset[seriesItem.index]).getTime()
              : start.getTime(),
            this._seriesOffset[seriesItem.index]
              ? new Date(end.getTime() + this._seriesOffset[seriesItem.index]).getTime()
              : end.getTime(),
            this._serverTimeOffset - (this._seriesTimeDelta[seriesItem.index] || 0),
          ) || {
            min: [0, null],
            max: [0, null],
          };
          const bgColor = computeColor(this._colors[index]);
          const txtColor = computeTextColor(bgColor);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const extremas: any = [];
          if (min[0] && ['min', 'min+time', true, 'time'].includes(seriesItem.show.extremas)) {
            const withTime = seriesItem.show.extremas === 'time' || seriesItem.show.extremas === 'min+time';
            extremas.push(
              ...this._getPointAnnotationStyle(
                min,
                this._seriesOffset[seriesItem.index],
                bgColor,
                txtColor,
                seriesItem,
                index,
                seriesItem.invert,
                sameDay,
                withTime,
              ),
            );
          }
          if (max[0] && ['max', 'max+time', true, 'time'].includes(seriesItem.show.extremas)) {
            const withTime = seriesItem.show.extremas === 'time' || seriesItem.show.extremas === 'max+time';
            extremas.push(
              ...this._getPointAnnotationStyle(
                max,
                this._seriesOffset[seriesItem.index],
                bgColor,
                txtColor,
                seriesItem,
                index,
                seriesItem.invert,
                sameDay,
                withTime,
              ),
            );
          }
          return extremas;
        } else {
          return [];
        }
      }),
    };
  }

  private _getPointAnnotationStyle(
    value: HistoryPoint,
    offset: number,
    bgColor: string,
    txtColor: string,
    seriesItem: ChartCardSeriesConfig,
    index: number,
    invert = false,
    sameDay: boolean,
    withTime: boolean,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const points: any = [];
    const multiYAxis =
      this._config?.apex_config?.yaxis &&
      Array.isArray(this._config.apex_config.yaxis) &&
      this._config.apex_config.yaxis.length > 1;
    points.push({
      x: offset ? value[0] - offset : value[0],
      y: invert && value[1] ? -value[1] : value[1],
      seriesIndex: index,
      yAxisIndex: multiYAxis ? index : 0,
      marker: {
        strokeColor: bgColor,
        fillColor: 'var(--card-background-color)',
      },
      label: {
        text: myFormatNumber(value[1], this._hass?.locale, seriesItem.float_precision),
        borderColor: 'var(--card-background-color)',
        borderWidth: 2,
        style: {
          background: bgColor,
          color: txtColor,
        },
      },
    });
    if (withTime) {
      let bgColorTime = tinycolor(computeColor('var(--card-background-color)'));
      bgColorTime =
        bgColorTime.isValid && bgColorTime.getLuminance() > 0.5 ? bgColorTime.darken(20) : bgColorTime.lighten(20);
      const txtColorTime = computeTextColor(bgColorTime.toHexString());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let options: any = { timeStyle: 'medium' };
      if (!sameDay) {
        options.dateStyle = 'medium';
      }
      options = { ...options, ...(is12Hour(this._config, this._hass) ? { hour12: true } : { hourCycle: 'h23' }) };
      const lang = getLang(this._config, this._hass);
      points.push({
        x: offset ? value[0] - offset : value[0],
        y: invert && value[1] ? -value[1] : value[1],
        seriesIndex: index,
        yAxisIndex: multiYAxis ? index : 0,
        marker: {
          size: 0,
        },
        label: {
          text: `${Intl.DateTimeFormat(lang, options).format(value[0])}`,
          borderColor: 'var(--card-background-color)',
          offsetY: -22,
          borderWidth: 0,
          style: {
            background: bgColorTime.toHexString(),
            color: txtColorTime,
            fontSize: '8px',
            fontWeight: 200,
          },
        },
      });
    }
    return points;
  }

  private _computeNowAnnotation(now: Date) {
    if (this._config?.now?.show) {
      const color = computeColor(this._config.now.color || 'var(--primary-color)');
      const textColor = computeTextColor(color);
      return {
        xaxis: [
          {
            x: now.getTime(),
            strokeDashArray: 3,
            label: {
              text: this._config.now.label,
              borderColor: color,
              style: {
                color: textColor,
                background: color,
              },
            },
            borderColor: color,
          },
        ],
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

  private _computeChartColors(brush: boolean): (string | (({ value }) => string))[] {
    const defaultColors: (string | (({ value }) => string))[] = computeColors(brush ? this._brushColors : this._colors);
    const series = brush ? this._config?.series_in_brush : this._config?.series_in_graph;
    series?.forEach((seriesItem, _index) => {
      if (
        this._config?.experimental?.color_threshold &&
        (PLAIN_COLOR_TYPES.includes(this._config!.chart_type!) || seriesItem.type === 'column') &&
        seriesItem.color_threshold &&
        seriesItem.color_threshold.length > 0
      ) {
        const colors = this._colors;

        defaultColors[_index] = function ({ value }, sortedL = seriesItem.color_threshold!, defColor = colors[_index]) {
          let returnValue = sortedL[0].color || defColor;
          sortedL.forEach((color) => {
            if (value > color.value) returnValue = color.color || defColor;
          });
          return computeColor(returnValue);
        };
      }
    });
    return defaultColors.slice(0, this._config?.series_in_graph.length);
  }

  private _computeFillColorStops(
    seriesItem: ChartCardSeriesConfig,
    min: number,
    max: number,
    defColor: string,
    invert = false,
  ): { offset: number; color: string; opacity?: number }[] | undefined {
    if (!seriesItem.color_threshold) return undefined;
    const scale = max - min;

    const result = seriesItem.color_threshold.flatMap((thres, index, arr) => {
      if (
        (thres.value > max && arr[index - 1] && arr[index - 1].value > max) ||
        (thres.value < min && arr[index + 1] && arr[index + 1].value < min)
      ) {
        return [];
      }
      let color: string | undefined = undefined;
      const defaultOp =
        seriesItem.opacity !== undefined ? seriesItem.opacity : seriesItem.type === 'area' ? DEFAULT_AREA_OPACITY : 1;
      let opacity = thres.opacity === undefined ? defaultOp : thres.opacity;
      if (thres.value > max && arr[index - 1]) {
        const factor = (max - arr[index - 1].value) / (thres.value - arr[index - 1].value);
        color = interpolateColor(
          tinycolor(arr[index - 1].color || defColor).toHexString(),
          tinycolor(thres.color || defColor).toHexString(),
          factor,
        );

        const prevOp = arr[index - 1].opacity === undefined ? defaultOp : arr[index - 1].opacity!;

        const curOp = thres.opacity === undefined ? defaultOp : thres.opacity!;

        if (prevOp > curOp) {
          opacity = (prevOp - curOp) * (1 - factor) + curOp;
        } else {
          opacity = (curOp - prevOp) * factor + prevOp;
        }
        opacity = opacity < 0 ? -opacity : opacity;
      } else if (thres.value < min && arr[index + 1]) {
        const factor = (arr[index + 1].value - min) / (arr[index + 1].value - thres.value);
        color = interpolateColor(
          tinycolor(arr[index + 1].color || defColor).toHexString(),
          tinycolor(thres.color || defColor).toHexString(),
          factor,
        );

        const nextOp = arr[index + 1].opacity === undefined ? defaultOp : arr[index + 1].opacity!;

        const curOp = thres.opacity === undefined ? defaultOp : thres.opacity!;
        if (nextOp > curOp) {
          opacity = (nextOp - curOp) * (1 - factor) + curOp;
        } else {
          opacity = (curOp - nextOp) * factor + nextOp;
        }
        opacity = opacity < 0 ? -opacity : opacity;
      }
      color = color || tinycolor(thres.color || defColor).toHexString();
      if ([undefined, 'line'].includes(seriesItem.type)) color = tinycolor(color).setAlpha(opacity).toHex8String();
      return [
        {
          color: color || tinycolor(thres.color || defColor).toHexString(),
          offset:
            scale <= 0 ? 0 : invert ? 100 - (max - thres.value) * (100 / scale) : (max - thres.value) * (100 / scale),
          opacity,
        },
      ];
    });
    return invert ? result : result.reverse();
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
        const dur = parse(seriesItem.group_by.duration)!;
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
    const now = new Date(); // Use current date/time

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _arrayFilter = (array: any[], conditions: Array<(value: any) => boolean>, maxSize: number) => {
      if (!maxSize || maxSize > array.length) {
        maxSize = array.length;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  public addEventListener(): void {
    // ... existing code ...
  }

  public removeEventListener(): void {
    // ... existing code ...
  }

  public dispatchEvent(): boolean {
    // ... existing code ...
    return true;
  }

  public handleEvent(): void {
    // ... existing code ...
  }
}

// Configure the preview in the Lovelace card picker
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).customCards = (window as any).customCards || [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// END ADD Helper functions
