# ChartCardSeriesExternalConfig

The `ChartCardSeriesExternalConfig` interface extends the `ChartCardAllSeriesExternalConfig` interface and defines the configuration for a single data series in the ApexCharts card.

## Own Properties

| Property | Type | Description |
|----------|------|-------------|
| `entity` | `string` | **Required**. The Home Assistant entity ID whose data will be displayed. |
| `header_config` | `object` | Optional configuration for this series' header display. |
| `header_config.show_state` | `boolean` | Whether to show the current state in the header. |
| `header_config.show_uom` | `boolean` | Whether to show the unit of measurement in the header. |
| `header_config.show_name` | `boolean` | Whether to show the name in the header. |
| `period` | `StatisticsPeriod` | Optional statistics period for this series ('5minute', 'hour', 'day', 'week', 'month'). |

## Properties Inherited from ChartCardAllSeriesExternalConfig

| Property | Type | Description |
|----------|------|-------------|
| `attribute` | `string` | Entity attribute to display. |
| `name` | `string` | Display name for the series. |
| `type` | `'line' \| 'column' \| 'area' \| 'scatter' \| 'pie' \| 'donut' \| 'radialBar'` | Chart type for this series. |
| `stack_group` | `string` | Stacking group for stacked charts. |
| `color` | `string` | Color of the series. |
| `opacity` | `number` | Opacity/transparency of the series. |
| `curve` | `'smooth' \| 'straight' \| 'stepline' \| 'monotoneCubic'` | Curve type for line charts. |
| `stroke_width` | `number` | Width of the line. |
| `stroke_dash` | `number` | Dash pattern of the line. |
| `extend_to` | `false \| 'end' \| 'now'` | Extends the data to a specific point. |
| `unit` | `string` | Unit of measurement for the data. |
| `invert` | `boolean` | Inverts the data (multiplies by -1). |
| `data_generator` | `string` | Custom data generator. |
| `statistics` | `object` | Configuration for statistics-based data. |
| `statistics.type` | `'mean' \| 'max' \| 'min' \| 'sum' \| 'state' \| 'change'` | Type of statistical calculation. |
| `statistics.period` | `StatisticsPeriod` | Time period for statistical calculation. |
| `statistics.align` | `'start' \| 'end' \| 'middle'` | Alignment of statistical values within the period. |
| `float_precision` | `number` | Number of decimal places. |
| `min` | `number` | Minimum value for the Y-axis. |
| `max` | `number` | Maximum value for the Y-axis. |
| `offset` | `string` | Time offset for the data. |
| `time_delta` | `string` | Time delta between data points. |
| `fill_raw` | `GroupByFill` | Method for filling missing raw data ('null', 'last', 'zero'). |
| `show` | `ChartCardSeriesShowConfigExt` | Display options for various parts of the chart. |
| `group_by` | `object` | Configuration for grouping data points. |
| `group_by.duration` | `string` | Duration for grouping. |
| `group_by.func` | `GroupByFunc` | Function for grouping (e.g., 'avg', 'min', 'max'). |
| `group_by.fill` | `GroupByFill` | Method for filling missing grouped data. |
| `group_by.start_with_last` | `boolean` | Start with the last value. |
| `transform` | `string` | Transformation formula for data values. |
| `color_threshold` | `ChartCardColorThreshold[]` | Color thresholds based on data values. |
| `yaxis_id` | `string` | ID of the Y-axis this series is bound to. |
| `header_actions` | `ActionsConfig` | Action configuration for the header. |