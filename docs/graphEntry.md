# GraphEntry Class

## Overview
The `GraphEntry` class is a core component of the ApexCharts Card for Home Assistant. It manages a single data series (graph/series) and is responsible for:
- Retrieving historical data from the Home Assistant API
- Applying transformations and calculations to data points
- Implementing data aggregation and grouping
- Providing analysis functions like min/max determination
- Caching data for performance optimization

This class is instantiated for each data series defined in the card configuration and enables efficient management and visualization of time-series data.

## Constructor
```typescript
constructor(
  index: number,
  graphSpan: number,
  cache: boolean,
  config: ChartCardSeriesConfig,
  span: ChartCardSpanExtConfig | undefined
)
```

- `index`: Index of the data series in the configuration
- `graphSpan`: Time span of the graph in milliseconds
- `cache`: Whether data should be cached
- `config`: Configuration of the data series
- `span`: Extended configuration for the time span

## Properties

### `history: EntityCachePoints`
Returns the computed history data as an array of timestamp-value pairs (`[timestamp, value]`).

### `index: number`
The index of the data series in the card configuration.

### `start: Date`
The start date of the captured time period.

### `end: Date`
The end date of the captured time period.

### `lastState: number | null`
The value of the last data point or `null` if no data is available.

### `min: number | undefined`
The minimum value in the history or `undefined` if no data is available.

### `max: number | undefined`
The maximum value in the history or `undefined` if no data is available.

## Methods

### `set hass(hass: HomeAssistant)`
Sets the Home Assistant instance and updates the entity state.

### `set cache(cache: boolean)`
Configures whether data should be cached (ignored for statistics data).

### `nowValue(now: number, before: boolean): number | null`
Returns the value at a specific timestamp.
- `now`: The timestamp for which to determine the value
- `before`: If `true`, returns the last value before the timestamp; if `false`, the first value after the timestamp

### `minMaxWithTimestamp(start: number, end: number, offset: number): { min: HistoryPoint; max: HistoryPoint } | undefined`
Returns the minimum and maximum data points with timestamps within a specific range.
- `start`: Start time of the range
- `end`: End time of the range
- `offset`: A time offset to be applied to the timestamps

### `minMaxWithTimestampForYAxis(start: number, end: number): { min: HistoryPoint; max: HistoryPoint } | undefined`
A variant of `minMaxWithTimestamp` optimized for Y-axis calculation.
- Takes into account the last data point before the start date

### `_updateHistory(start: Date, end: Date): Promise<boolean>`
The central method for updating the history data for the specified period. This method:
1. If `ignore_history` is configured, uses only the current entity state
2. Otherwise:
   - Checks the cache for existing data
   - Retrieves new data from the Home Assistant API
   - Processes and transforms the data
   - Applies grouping (if configured)
   - Updates the cache (if enabled)
   - Updates the internal data stores

Parameters:
- `start`: Start date of the period to retrieve
- `end`: End date of the period to retrieve

Return value:
- `Promise<boolean>`: `true` if the update was successful, otherwise `false`