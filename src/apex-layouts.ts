import { HomeAssistant } from 'custom-card-helpers';
import _parse from 'parse-duration';
import {
  DEFAULT_AREA_OPACITY,
  DEFAULT_FLOAT_PRECISION,
  DEFAULT_LEGEND_MARKER_WIDTH,
  DEFAULT_SERIES_TYPE,
  HOUR_24,
  NO_VALUE,
  PLAIN_COLOR_TYPES,
  TIMESERIES_TYPES,
} from './const';
import { ChartCardConfig } from './types';
import { computeName, computeUom, is12Hour, mergeDeep, myFormatNumber, prettyPrintTime } from './utils';
import { layoutMinimal } from './layouts/minimal';
import { getLocales, getDefaultLocale } from './locales';
import GraphEntry from './graphEntry';

export function getLayoutConfig(
  config: ChartCardConfig,
  hass: HomeAssistant | undefined = undefined,
  graphs: (GraphEntry | undefined)[] | undefined,
): unknown {
  const locales = getLocales();
  const def = {
    chart: {
      locales: [
        (config.locale && locales[config.locale]) || (hass?.language && locales[hass.language]) || getDefaultLocale(),
      ],
      defaultLocale:
        (config.locale && locales[config.locale] && config.locale) ||
        (hass?.language && locales[hass.language] && hass.language) ||
        'en',
      type: config.chart_type || DEFAULT_SERIES_TYPE,
      stacked: config?.stacked,
      foreColor: 'var(--primary-text-color)',
      width: '100%',
      zoom: {
        enabled: false,
      },
      toolbar: {
        show: false,
      },
    },
    grid: {
      strokeDashArray: 3,
    },
    fill: {
      opacity: getFillOpacity(config, false),
      type: getFillType(config, false),
    },
    series: getSeries(config, hass, false),
    labels: getLabels(config, hass),
    xaxis: getXAxis(config, hass),
    yaxis: getYAxis(config),
    tooltip: {
      x: {
        formatter: getXTooltipFormatter(config, hass),
      },
      y: {
        formatter: getYTooltipFormatter(config, hass),
      },
    },
    dataLabels: {
      enabled: getDataLabelsEnabled(config),
      enabledOnSeries: getDataLabels_enabledOnSeries(config),
      formatter: getDataLabelsFormatter(config, graphs, hass),
    },
    plotOptions: {
      radialBar: getPlotOptions_radialBar(config, hass),
    },
    legend: {
      position: 'bottom',
      show: true,
      formatter: getLegendFormatter(config, hass),
      markers: getLegendMarkers(config),
    },
    stroke: {
      curve: getStrokeCurve(config, false),
      lineCap: config.chart_type === 'radialBar' ? 'round' : 'butt',
      colors:
        config.chart_type === 'pie' || config.chart_type === 'donut' ? ['var(--card-background-color)'] : undefined,
      width: getStrokeWidth(config, false),
      dashArray: getStrokeDash(config, false),
    },
    markers: {
      showNullDataPoints: false,
    },
    noData: {
      text: 'Loading...',
    },
  };

  let conf = {};
  switch (config.layout) {
    case 'minimal':
      conf = layoutMinimal;
      break;

    default:
      break;
  }

  return config.apex_config
    ? mergeDeep(mergeDeep(def, conf), evalApexConfig(config.apex_config))
    : mergeDeep(def, conf);
}

export function getBrushLayoutConfig(
  config: ChartCardConfig,
  hass: HomeAssistant | undefined = undefined,
  id: string,
): unknown {
  const locales = getLocales();
  const def = {
    chart: {
      locales: [
        (config.locale && locales[config.locale]) || (hass?.language && locales[hass.language]) || getDefaultLocale(),
      ],
      defaultLocale:
        (config.locale && locales[config.locale] && config.locale) ||
        (hass?.language && locales[hass.language] && hass.language) ||
        'en',
      type: config.chart_type || DEFAULT_SERIES_TYPE,
      stacked: config?.stacked,
      foreColor: 'var(--primary-text-color)',
      width: '100%',
      height: '120px',
      zoom: {
        enabled: false,
      },
      toolbar: {
        show: false,
      },
      id: Math.random().toString(36).substring(7),
      brush: {
        target: id,
        enabled: true,
      },
    },
    grid: {
      strokeDashArray: 3,
    },
    fill: {
      opacity: getFillOpacity(config, true),
      type: getFillType(config, true),
    },
    series: getSeries(config, hass, true),
    xaxis: getXAxis(config, hass),
    yaxis: {
      tickAmount: 2,
      decimalsInFloat: DEFAULT_FLOAT_PRECISION,
    },
    tooltip: {
      enabled: false,
    },
    dataLabels: {
      enabled: false,
    },
    legend: {
      show: false,
    },
    stroke: {
      curve: getStrokeCurve(config, true),
      lineCap: config.chart_type === 'radialBar' ? 'round' : 'butt',
      colors:
        config.chart_type === 'pie' || config.chart_type === 'donut' ? ['var(--card-background-color)'] : undefined,
      width: getStrokeWidth(config, true),
      dashArray: getStrokeDash(config, false),
    },
    markers: {
      showNullDataPoints: false,
    },
    noData: {
      text: 'Loading...',
    },
  };
  return config.brush?.apex_config ? mergeDeep(def, evalApexConfig(config.brush.apex_config)) : def;
}

function getFillOpacity(config: ChartCardConfig, brush: boolean): number[] {
  const series = brush ? config.series_in_brush : config.series_in_graph;
  return series.map((seriesItem) => {
    return seriesItem.opacity !== undefined
      ? seriesItem.opacity
      : seriesItem.type === 'area'
        ? DEFAULT_AREA_OPACITY
        : 1;
  });
}

function getSeries(config: ChartCardConfig, hass: HomeAssistant | undefined, brush: boolean) {
  const series = brush ? config.series_in_brush : config.series_in_graph;
  if (TIMESERIES_TYPES.includes(config.chart_type)) {
    return series.map((seriesItem, index) => {
      return {
        name: computeName(index, series, undefined, hass?.states[seriesItem.entity]),
        group: config.stacked && seriesItem.type === 'column' ? seriesItem.stack_group : undefined,
        type: seriesItem.type,
        data: [],
      };
    });
  } else {
    return [];
  }
}

function getLabels(config: ChartCardConfig, hass: HomeAssistant | undefined) {
  if (TIMESERIES_TYPES.includes(config.chart_type)) {
    return [];
  } else {
    return config.series_in_graph.map((seriesItem, index) => {
      return computeName(index, config.series_in_graph, undefined, hass?.states[seriesItem.entity]);
    });
  }
}

function getXAxis(config: ChartCardConfig, hass: HomeAssistant | undefined) {
  if (TIMESERIES_TYPES.includes(config.chart_type)) {
    const hours12 = is12Hour(config, hass);
    return {
      type: 'datetime',
      // range: getMilli(config.hours_to_show),
      labels: {
        datetimeUTC: false,
        datetimeFormatter: getDateTimeFormatter(hours12),
      },
    };
  } else {
    return {};
  }
}

function getYAxis(config: ChartCardConfig) {
  return Array.isArray(config.apex_config?.yaxis) || config.yaxis
    ? undefined
    : {
        decimalsInFloat: DEFAULT_FLOAT_PRECISION,
      };
}

function getDateTimeFormatter(hours12: boolean | undefined): unknown {
  if (!hours12) {
    return {
      year: 'yyyy',
      month: "MMM 'yy",
      day: 'dd MMM',
      hour: 'HH:mm',
      minute: 'HH:mm:ss',
    };
  } else {
    return {
      year: 'yyyy',
      month: "MMM 'yy",
      day: 'dd MMM',
      hour: 'hh:mm tt',
      minute: 'hh:mm:ss tt',
    };
  }
}

function getXTooltipFormatter(
  config: ChartCardConfig,
  hass: HomeAssistant | undefined,
): ((val: number, _a: unknown, _b: unknown) => string) | undefined {
  if (config.apex_config?.tooltip?.x?.format) return undefined;
  let hours12: { hour12: boolean } | { hourCycle: 'h11' | 'h12' | 'h23' | 'h24' } | undefined = undefined;
  const lang = config.locale || hass?.language || 'en';
  hours12 = is12Hour(config, hass) ? { hour12: true } : { hourCycle: 'h23' };

  return config.graph_span < HOUR_24 && !config.span?.offset
    ? function (val, _a, _b, hours_12 = hours12) {
        return new Intl.DateTimeFormat(lang, {
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          ...(hours_12 || {}),
        }).format(val);
      }
    : function (val, _a, _b, hours_12 = hours12) {
        return new Intl.DateTimeFormat(lang, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          ...(hours_12 || {}),
        }).format(val);
      };
}

function getYTooltipFormatter(config: ChartCardConfig, hass: HomeAssistant | undefined) {
  return function (value, opts, conf = config, hass2 = hass) {
    let lValue = value;
    if (conf.series_in_graph[opts.seriesIndex]?.invert && lValue) {
      lValue = -lValue;
    }
    if (!conf.series_in_graph[opts.seriesIndex]?.show.as_duration) {
      lValue = myFormatNumber(lValue, hass?.locale, conf.series_in_graph[opts.seriesIndex].float_precision);
    }
    const uom = computeUom(
      opts.seriesIndex,
      conf.series_in_graph,
      undefined,
      hass2?.states[conf.series_in_graph[opts.seriesIndex].entity],
    );
    return conf.series_in_graph[opts.seriesIndex]?.show.as_duration
      ? [`<strong>${prettyPrintTime(lValue, conf.series_in_graph[opts.seriesIndex].show.as_duration!)}</strong>`]
      : [`<strong>${lValue} ${uom}</strong>`];
  };
}

function getDataLabelsEnabled(config: ChartCardConfig): boolean {
  return (
    !TIMESERIES_TYPES.includes(config.chart_type) ||
    config.series_in_graph.some((seriesItem) => {
      return seriesItem.show.datalabels;
    })
  );
}

function getDataLabelsFormatter(
  config: ChartCardConfig,
  graphs: (GraphEntry | undefined)[] | undefined,
  hass: HomeAssistant | undefined,
) {
  if (config.chart_type === 'pie' || config.chart_type === 'donut') {
    return function (value, opts, lgraphs = graphs, conf = config, lHass = hass) {
      if (conf.series_in_graph[opts.seriesIndex].show.datalabels !== false) {
        if (conf.series_in_graph[opts.seriesIndex].show.datalabels === 'percent') {
          return myFormatNumber(value, lHass?.locale, conf.series_in_graph[opts.seriesIndex].float_precision);
        }
        return myFormatNumber(
          lgraphs?.[conf.series_in_graph[opts.seriesIndex].index]?.lastState,
          lHass?.locale,
          conf.series_in_graph[opts.seriesIndex].float_precision,
        );
      }
      return '';
    };
  }
  return function (value, opts, conf = config, lHass = hass) {
    if (conf.series_in_graph[opts.seriesIndex].show.datalabels === 'total') {
      return myFormatNumber(
        opts.w.globals.stackedSeriesTotals[opts.dataPointIndex],
        lHass?.locale,
        conf.series_in_graph[opts.seriesIndex].float_precision,
      );
    }
    if (value === null) return;
    let lValue = value;
    if (conf.series_in_graph[opts.seriesIndex]?.invert && lValue) {
      lValue = -lValue;
    }
    return myFormatNumber(lValue, lHass?.locale, conf.series_in_graph[opts.seriesIndex].float_precision);
  };
}

function getPlotOptions_radialBar(config: ChartCardConfig, hass: HomeAssistant | undefined) {
  if (config.chart_type === 'radialBar') {
    return {
      track: {
        background: 'rgba(128, 128, 128, 0.2)',
      },
      dataLabels: {
        value: {
          formatter: function (value, opts, conf = config, lHass = hass) {
            const index = opts?.config?.series?.findIndex((x) => {
              return parseFloat(value) === x;
            });
            if (index != -1) {
              return myFormatNumber(value, lHass?.locale, conf.series_in_graph[index].float_precision) + '%';
            }
            return value;
          },
        },
      },
    };
  } else {
    return {};
  }
}

function getLegendFormatter(config: ChartCardConfig, hass: HomeAssistant | undefined) {
  return function (_, opts, conf = config, hass2 = hass) {
    const name = computeName(
      opts.seriesIndex,
      conf.series_in_graph,
      undefined,
      hass2?.states[conf.series_in_graph[opts.seriesIndex].entity],
    );
    if (!conf.series_in_graph[opts.seriesIndex].show.in_legend) {
      return [];
    }
    if (!conf.series_in_graph[opts.seriesIndex].show.legend_value) {
      return [name];
    } else {
      let value = TIMESERIES_TYPES.includes(config.chart_type)
        ? opts.w.globals.series[opts.seriesIndex].slice(-1)[0]
        : opts.w.globals.series[opts.seriesIndex];
      if (conf.series_in_graph[opts.seriesIndex]?.invert && value) {
        value = -value;
      }
      if (!conf.series_in_graph[opts.seriesIndex]?.show.as_duration) {
        value = myFormatNumber(value, hass2?.locale, conf.series_in_graph[opts.seriesIndex].float_precision);
      }
      const uom =
        config.chart_type === 'radialBar'
          ? '%'
          : computeUom(
              opts.seriesIndex,
              conf.series_in_graph,
              undefined,
              hass2?.states[conf.series_in_graph[opts.seriesIndex].entity],
            );
      let valueString = '';
      if (value === undefined || value === null) {
        valueString = `<strong>${NO_VALUE} ${uom}</strong>`;
      } else {
        if (conf.series_in_graph[opts.seriesIndex]?.show.as_duration) {
          valueString = `<strong>${prettyPrintTime(
            value,

            conf.series_in_graph[opts.seriesIndex].show.as_duration!,
          )}</strong>`;
        } else {
          valueString = `<strong>${value} ${uom}</strong>`;
        }
      }
      return [name + ':', valueString];
    }
  };
}

function getLegendMarkers(config: ChartCardConfig) {
  return {
    size: config.series_in_graph.map((seriesItem) => (seriesItem.show.in_legend ? DEFAULT_LEGEND_MARKER_WIDTH : 0)),
  };
}

function getStrokeCurve(config: ChartCardConfig, brush: boolean) {
  const series = brush ? config.series_in_brush : config.series_in_graph;
  return series.map((seriesItem) => {
    return seriesItem.curve || 'smooth';
  });
}

function getDataLabels_enabledOnSeries(config: ChartCardConfig) {
  return config.series_in_graph.flatMap((seriesItem, index) => {
    return seriesItem.show.datalabels ? [index] : [];
  });
}

function getStrokeWidth(config: ChartCardConfig, brush: boolean) {
  if (config.chart_type !== undefined && config.chart_type !== 'line')
    return config.apex_config?.stroke?.width === undefined ? 3 : config.apex_config?.stroke?.width;
  const series = brush ? config.series_in_brush : config.series_in_graph;
  return series.map((seriesItem) => {
    if (seriesItem.stroke_width !== undefined) {
      return seriesItem.stroke_width;
    }
    return [undefined, 'line', 'area'].includes(seriesItem.type) ? 5 : 0;
  });
}

function getStrokeDash(config: ChartCardConfig, brush: boolean) {
  const series = brush ? config.series_in_brush : config.series_in_graph;
  return series.map((seriesItem) => {
    return seriesItem.stroke_dash;
  });
}

function getFillType(config: ChartCardConfig, brush: boolean) {
  if (!config.experimental?.color_threshold) {
    return brush ? config.brush?.apex_config?.fill?.type || 'solid' : config.apex_config?.fill?.type || 'solid';
  } else {
    const series = brush ? config.series_in_brush : config.series_in_graph;
    return series.map((seriesItem) => {
      if (
        !PLAIN_COLOR_TYPES.includes(config.chart_type!) &&
        seriesItem.type !== 'column' &&
        seriesItem.color_threshold &&
        seriesItem.color_threshold.length > 0
      ) {
        return 'gradient';
      }
      return 'solid';
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function evalApexConfig(apexConfig: any): any {
  const eval2 = eval;
  Object.keys(apexConfig).forEach((key) => {
    if (typeof apexConfig[key] === 'string' && apexConfig[key].trim().startsWith('EVAL:')) {
      apexConfig[key] = eval2(`(${apexConfig[key].trim().slice(5)})`);
    }
    if (typeof apexConfig[key] === 'object') {
      apexConfig[key] = evalApexConfig(apexConfig[key]);
    }
  });
  return apexConfig;
}
