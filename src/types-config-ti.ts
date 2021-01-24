/**
 * This module was automatically generated by `ts-interface-builder`
 */
import * as t from "ts-interface-checker";
// tslint:disable:object-literal-key-quotes

export const ChartCardExternalConfig = t.iface([], {
  "type": t.lit('custom:apexcharts-card'),
  "series": t.array("ChartCardSeriesExternalConfig"),
  "hours_to_show": t.opt("number"),
  "show": t.opt(t.iface([], {
    "loading": t.opt("boolean"),
  })),
  "cache": t.opt("boolean"),
  "stacked": t.opt("boolean"),
  "layout": t.opt("string"),
  "apex_config": t.opt("any"),
  "header": t.opt("ChartCardHeaderExternalConfig"),
});

export const ChartCardSeriesExternalConfig = t.iface([], {
  "entity": "string",
  "name": t.opt("string"),
  "type": t.opt(t.union(t.lit('line'), t.lit('bar'), t.lit('area'))),
  "curve": t.opt(t.union(t.lit('smooth'), t.lit('straight'), t.lit('stepline'))),
  "extend_to_end": t.opt("boolean"),
  "unit": t.opt("string"),
  "group_by": t.opt(t.iface([], {
    "duration": t.opt("string"),
    "func": t.opt("GroupByFunc"),
    "fill": t.opt("GroupByFill"),
  })),
});

export const GroupByFill = t.union(t.lit('null'), t.lit('last'), t.lit('zero'));

export const GroupByFunc = t.union(t.lit('raw'), t.lit('avg'), t.lit('min'), t.lit('max'), t.lit('last'), t.lit('first'), t.lit('sum'), t.lit('median'), t.lit('delta'));

export const ChartCardHeaderExternalConfig = t.iface([], {
  "show": t.opt("boolean"),
  "floating": t.opt("boolean"),
});

const exportedTypeSuite: t.ITypeSuite = {
  ChartCardExternalConfig,
  ChartCardSeriesExternalConfig,
  GroupByFill,
  GroupByFunc,
  ChartCardHeaderExternalConfig,
};
export default exportedTypeSuite;
