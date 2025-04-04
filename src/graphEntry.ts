import { HomeAssistant } from 'custom-card-helpers';
import {
  ChartCardSeriesConfig,
  EntityCachePoints,
  EntityEntryCache,
  HassHistory,
  HassHistoryEntry,
  HistoryBuckets,
  HistoryPoint,
  Statistics,
  StatisticValue,
} from './types';
import { compress, decompress, log } from './utils';
import localForage from 'localforage';
import { HassEntity } from 'home-assistant-js-websocket';
import { DEFAULT_STATISTICS_PERIOD, DEFAULT_STATISTICS_TYPE } from './const';
import parse from 'parse-duration';
import SparkMD5 from 'spark-md5';
import { ChartCardSpanExtConfig, StatisticsPeriod } from './types-config';
import * as pjson from '../package.json';

export default class GraphEntry {
  private _computedHistory?: EntityCachePoints;

  private _hass?: HomeAssistant;

  private _entityID: string;

  private _entityState?: HassEntity;

  private _updating = false;

  private _cache: boolean;

  // private _hoursToShow: number;

  private _graphSpan: number;

  private _useCompress = false;

  private _index: number;

  private _config: ChartCardSeriesConfig;

  private _func: (item: EntityCachePoints) => number;

  private _realStart: Date;

  private _realEnd: Date;

  private _groupByDurationMs: number;

  private _md5Config: string;

  constructor(
    index: number,
    graphSpan: number,
    cache: boolean,
    config: ChartCardSeriesConfig,
    span: ChartCardSpanExtConfig | undefined,
  ) {
    const aggregateFuncMap = {
      avg: this._average,
      max: this._maximum,
      min: this._minimum,
      first: this._first,
      last: this._last,
      sum: this._sum,
      median: this._median,
      delta: this._delta,
      diff: this._diff,
    };
    this._index = index;
    this._cache = config.statistics ? false : cache;
    this._entityID = config.entity;
    this._graphSpan = graphSpan;
    this._config = config;
    this._func = aggregateFuncMap[config.group_by.func];
    this._realEnd = new Date();
    this._realStart = new Date();
    // Valid because tested during init;

    this._groupByDurationMs = parse(this._config.group_by.duration)!;
    this._md5Config = SparkMD5.hash(`${this._graphSpan}${JSON.stringify(this._config)}${JSON.stringify(span)}`);
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    this._entityState = this._hass.states[this._entityID];
  }

  get history(): EntityCachePoints {
    return this._computedHistory || [];
  }

  get index(): number {
    return this._index;
  }

  get start(): Date {
    return this._realStart;
  }

  get end(): Date {
    return this._realEnd;
  }

  set cache(cache: boolean) {
    this._cache = this._config.statistics ? false : cache;
  }

  get lastState(): number | null {
    return this.history.length > 0 ? this.history[this.history.length - 1][1] : null;
  }

  public nowValue(now: number, before: boolean): number | null {
    if (this.history.length === 0) return null;
    const index = this.history.findIndex((point, index, arr) => {
      if (!before && point[0] > now) return true;
      if (before && point[0] < now && arr[index + 1] && arr[index + 1][0] > now) return true;
      return false;
    });
    if (index === -1) return null;
    return this.history[index][1];
  }

  get min(): number | undefined {
    if (!this._computedHistory || this._computedHistory.length === 0) return undefined;
    return Math.min(...this._computedHistory.flatMap((item) => (item[1] === null ? [] : [item[1]])));
  }

  get max(): number | undefined {
    if (!this._computedHistory || this._computedHistory.length === 0) return undefined;
    return Math.max(...this._computedHistory.flatMap((item) => (item[1] === null ? [] : [item[1]])));
  }

  public minMaxWithTimestamp(
    start: number,
    end: number,
    offset: number,
  ): { min: HistoryPoint; max: HistoryPoint } | undefined {
    if (!this._computedHistory || this._computedHistory.length === 0) return undefined;
    if (this._computedHistory.length === 1)
      return { min: [start, this._computedHistory[0][1]], max: [end, this._computedHistory[0][1]] };
    const minMax = this._computedHistory.reduce(
      (acc: { min: HistoryPoint; max: HistoryPoint }, point) => {
        if (point[1] === null) return acc;
        if (point[0] > end || point[0] < start) return acc;
        if (acc.max[1] === null || acc.max[1] < point[1]) acc.max = [...point];
        if (acc.min[1] === null || (point[1] !== null && acc.min[1] > point[1])) acc.min = [...point];
        return acc;
      },
      { min: [0, null], max: [0, null] },
    );
    if (offset) {
      if (minMax.min[0]) minMax.min[0] -= offset;
      if (minMax.max[0]) minMax.max[0] -= offset;
    }
    return minMax;
  }

  public minMaxWithTimestampForYAxis(start: number, end: number): { min: HistoryPoint; max: HistoryPoint } | undefined {
    if (!this._computedHistory || this._computedHistory.length === 0) return undefined;
    let lastTimestampBeforeStart = start;
    const lastHistoryIndexBeforeStart =
      this._computedHistory.findIndex((hist) => {
        return hist[0] >= start;
      }) - 1;
    if (lastHistoryIndexBeforeStart >= 0)
      lastTimestampBeforeStart = this._computedHistory[lastHistoryIndexBeforeStart][0];
    return this.minMaxWithTimestamp(lastTimestampBeforeStart, end, 0);
  }

  private async _getCache(key: string, compressed: boolean): Promise<EntityEntryCache | undefined> {
    const data: EntityEntryCache | undefined | null = await localForage.getItem(
      `${key}_${this._md5Config}${compressed ? '' : '-raw'}`,
    );
    return data ? (compressed ? decompress(data) : data) : undefined;
  }

  private async _setCache(
    key: string,
    data: EntityEntryCache,
    compressed: boolean,
  ): Promise<string | EntityEntryCache> {
    return compressed
      ? localForage.setItem(`${key}_${this._md5Config}`, compress(data))
      : localForage.setItem(`${key}_${this._md5Config}-raw`, data);
  }

  public async _updateHistory(start: Date, end: Date): Promise<boolean> {
    let startHistory = new Date(start);
    if (this._config.group_by.func !== 'raw') {
      const range = end.getTime() - start.getTime();
      const nbBuckets = Math.floor(range / this._groupByDurationMs) + (range % this._groupByDurationMs > 0 ? 1 : 0);
      startHistory = new Date(end.getTime() - (nbBuckets + 1) * this._groupByDurationMs);
    }
    if (!this._entityState || this._updating) return false;
    this._updating = true;

    if (this._config.ignore_history) {
      let currentState: null | number | string = null;
      if (this._config.attribute) {
        currentState = this._entityState.attributes?.[this._config.attribute];
      } else {
        currentState = this._entityState.state;
      }
      if (this._config.transform) {
        currentState = this._applyTransform(currentState, this._entityState);
      }
      let stateParsed: number | null = parseFloat(currentState as string);
      stateParsed = !Number.isNaN(stateParsed) ? stateParsed : null;
      this._computedHistory = [[new Date(this._entityState.last_updated).getTime(), stateParsed]];
      this._updating = false;
      return true;
    }

    let history = this._cache ? await this._getCache(this._entityID, this._useCompress) : undefined;
    if (!history || !history.card_version || history.card_version !== pjson.version) {
      startHistory = new Date(0);
      history = undefined;
    }
    if (history && history.span < startHistory.getTime()) {
      startHistory = new Date(history.span);
    }

    const newHistory = await this._fetchHistory(startHistory, end);
    let computedHistory: EntityCachePoints = (history && history.data) || [];

    if (newHistory && newHistory.length > 0) {
      computedHistory = this._processHistory(computedHistory, newHistory, startHistory, end);
      if (this._cache) {
        this._setCache(
          this._entityID,
          {
            card_version: pjson.version,
            span: startHistory.getTime(),
            data: computedHistory,
            last_fetched: new Date(),
          },
          this._useCompress,
        );
      }
    }

    this._computedHistory = computedHistory;

    if (this._config.group_by.func !== 'raw') {
      const res: EntityCachePoints = this._dataBucketer(this._computedHistory, startHistory, end).map((bucket) => {
        const value = bucket.data.length > 0 ? this._func(bucket.data) : null;
        return [bucket.timestamp, value];
      });
      if ([undefined, 'line', 'area'].includes(this._config.type)) {
        while (res.length > 0 && res[0][1] === null) res.shift();
      }
      this._computedHistory = res;
    }
    this._updating = false;
    return true;
  }

  private _transformAndFill(
    currentState: unknown,
    item: HassHistoryEntry | StatisticValue,
    lastNonNull: number | null,
  ): [number | null, number | null] {
    let state: number | null = null;
    let currentNonNull = lastNonNull;

    state = this._applyTransform(currentState, item);

    if (state !== null) {
      currentNonNull = state;
    } else if (this._config.fill_raw === 'last') {
      state = lastNonNull;
    } else if (this._config.fill_raw === 'zero') {
      state = 0;
    }

    return [state, currentNonNull];
  }

  private _applyTransform(value: unknown, historyItem: HassHistoryEntry | StatisticValue): number | null {
    if (value === null || typeof value === 'undefined' || value === 'unavailable' || value === 'unknown') return null;
    let numValue = Number(value);
    if (Number.isNaN(numValue)) return null;
    if (this._config.transform) {
      try {
        const func = new Function('x', 'item', `'use strict'; ${this._config.transform}`);
        numValue = func(numValue, historyItem);
        if (typeof numValue !== 'number' || Number.isNaN(numValue)) {
          throw new Error(`Transform function returned non-numeric value or NaN: ${numValue}`);
        }
      } catch (e) {
        console.error(
          `Error evaluating transform function for ${this._entityID}:`,
          e,
          `Function: ${this._config.transform}`,
          `Input: ${value}`,
        );
        return null;
      }
    }
    return numValue;
  }

  private async _fetchRecent(
    start: Date | undefined,
    end: Date | undefined,
    skipInitialState: boolean,
  ): Promise<HassHistory | undefined> {
    let url = 'history/period';
    if (start) url = `${url}/${start.toISOString()}`;
    url = `${url}?filter_entity_id=${this._entityID}`;
    if (end) url = `${url}&end_time=${end.toISOString()}`;
    url = `${url}&minimal_response`; // Don't retrieve attributes
    url = `${url}&no_attributes`; // Don't retrieve attributes
    if (skipInitialState) url = `${url}&skip_initial_state`; // Don't retrieve attributes

    try {
      return await this._hass?.callApi<HassHistory>('GET', url);
    } catch (err) {
      console.error(`Error fetching recent history for ${this._entityID}:`, err);
      // Don't rethrow, just return undefined
      return undefined;
    }
  }

  private async _generateData(start: Date, end: Date): Promise<EntityEntryCache> {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    let data;
    // Add try-catch around data_generator execution
    try {
      // Remove moment from data_generator function parameters
      const datafn = new AsyncFunction(
        'entity',
        'start',
        'end',
        'hass',
        // 'moment', REMOVED
        `'use strict'; ${this._config.data_generator}`,
      );
      // Remove moment from data_generator function call arguments
      data = await datafn(this._entityState, start, end, this._hass /*, moment REMOVED*/);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const funcTrimmed =
        this._config.data_generator!.length <= 100
          ? this._config.data_generator!.trim()
          : `${this._config.data_generator!.trim().substring(0, 98)}...`;
      // Modify error message to be more informative
      const errorMessage = `Error executing data_generator for ${this._entityID}: ${e.message} in '${funcTrimmed}'`;
      log(errorMessage);
      // Instead of re-throwing, let _updateHistory handle the failure (e.g., by returning false)
      // throw new Error(errorMessage);
      data = undefined; // Indicate failure
    }

    // Return structure should match EntityEntryCache, adjust if needed
    return {
      span: 0,
      card_version: pjson.version,
      last_fetched: new Date(), // This timestamp might not be accurate if generator fails
      data: data || [], // Return empty array on failure
    };
  }

  private async _fetchStatistics(
    start: Date | undefined,
    end: Date | undefined,
    period: StatisticsPeriod = DEFAULT_STATISTICS_PERIOD,
  ): Promise<EntityCachePoints | undefined> {
    if (!this._hass) return undefined;
    // Ensure msg conforms to MessageBase
    const msg = {
      type: 'recorder/statistics_during_period',
      start_time: start?.toISOString() || '',
      end_time: end?.toISOString() || '',
      statistic_ids: [this._entityID],
      period: period,
      types: [DEFAULT_STATISTICS_TYPE], // Only support sum for now
      id: 1, // Add required id property
    };

    let statisticsResult: Record<string, StatisticValue[]> | undefined;
    try {
      // Use Record<string, StatisticValue[]> for the expected result type
      statisticsResult = await this._hass.callWS<Record<string, StatisticValue[]>>(msg);
    } catch (err) {
      console.error(`Error fetching statistics for ${this._entityID}:`, err);
      // Don't rethrow, return empty array
      return [];
    }

    if (!statisticsResult || Object.keys(statisticsResult).length === 0) return [];

    const stats = statisticsResult[this._entityID];
    if (!stats || !Array.isArray(stats)) return []; // Check if stats is an array

    let lastNonNullState: number | null = null;
    const history: EntityCachePoints = stats.map((item: StatisticValue) => {
      // Explicitly type item
      // Adjust comparison based on the structure of series config for statistics
      const statValue = this._config.statistics?.type === 'sum' ? item.sum : item.state;
      const [state, lastNonNull] = this._transformAndFill(statValue, item, lastNonNullState);
      lastNonNullState = lastNonNull;
      const date = new Date(item.start);
      const timestamp = date.getTime();
      return [timestamp, state];
    });
    return history;
  }

  private _dataBucketer(history: EntityCachePoints, start: Date, end: Date): HistoryBuckets {
    if (!history || history.length === 0) return [];

    const buckets: HistoryBuckets = [];
    const startMs = start.getTime();
    const endMs = end.getTime();
    const groupingDuration = this._groupByDurationMs;

    if (groupingDuration <= 0) {
      log('Invalid group_by duration. Must be positive.');
      return []; // Or throw an error
    }

    // Determine the timestamp for the first bucket
    // Align buckets based on the end time, similar to how moment.range(...).by('duration') might work
    let bucketEndMs = endMs;
    while (bucketEndMs > startMs) {
      bucketEndMs -= groupingDuration;
    }
    // Now bucketEndMs is <= startMs. The first bucket *starts* after this time.
    let currentBucketStartMs = bucketEndMs;

    // Edge case: If the first point is exactly at or before the calculated start, include it.
    if (history.length > 0 && history[0][0] <= startMs) {
      // Adjust start slightly if needed, but generally covered by loop logic
    }

    let currentBucket: HistoryPoint[] = [];
    let historyIndex = 0;

    // Iterate through potential bucket start times
    while (currentBucketStartMs < endMs) {
      const currentBucketEndMs = currentBucketStartMs + groupingDuration;
      currentBucket = []; // Reset for the new bucket

      // Collect points that fall within the current bucket [start, end)
      while (historyIndex < history.length && history[historyIndex][0] < currentBucketEndMs) {
        // Only include points that are also >= the bucket start time
        if (history[historyIndex][0] >= currentBucketStartMs) {
          currentBucket.push(history[historyIndex]);
        }
        // Also include the last point before the bucket if filling is needed and func is raw/last/first?
        // This logic might need refinement based on exact fill/func behavior desired.

        historyIndex++;
      }

      // Add the bucket if it's relevant (within the overall start/end range)
      // Use the *end* of the bucket interval as the representative timestamp
      if (currentBucketEndMs > startMs) {
        // Ensure the bucket end is within the desired range
        buckets.push({
          // Using the end of the bucket interval as the timestamp
          timestamp: currentBucketEndMs,
          data: [...currentBucket],
        });
      }

      // Move to the next bucket
      currentBucketStartMs = currentBucketEndMs;
      // Reset historyIndex if needed? No, continue from where we left off.
    }

    return buckets;
  }

  private _sum(items: EntityCachePoints): number {
    if (items.length === 0) return 0;
    let lastIndex = 0;
    return items.reduce((sum, entry, index) => {
      let val = 0;
      if (entry && entry[1] === null) {
        val = items[lastIndex][1]!;
      } else {
        val = entry[1]!;
        lastIndex = index;
      }
      return sum + val;
    }, 0);
  }

  private _average(items: EntityCachePoints): number | null {
    const nonNull = this._filterNulls(items);
    if (nonNull.length === 0) return null;
    return this._sum(nonNull) / nonNull.length;
  }

  private _minimum(items: EntityCachePoints): number | null {
    let min: number | null = null;
    items.forEach((item) => {
      if (item[1] !== null)
        if (min === null) min = item[1];
        else min = Math.min(item[1], min);
    });
    return min;
  }

  private _maximum(items: EntityCachePoints): number | null {
    let max: number | null = null;
    items.forEach((item) => {
      if (item[1] !== null)
        if (max === null) max = item[1];
        else max = Math.max(item[1], max);
    });
    return max;
  }

  private _last(items: EntityCachePoints): number | null {
    if (items.length === 0) return null;
    return items.slice(-1)[0][1];
  }

  private _first(items: EntityCachePoints): number | null {
    if (items.length === 0) return null;
    return items[0][1];
  }

  private _median(items: EntityCachePoints) {
    const itemsDup = this._filterNulls([...items]).sort((a, b) => a[1]! - b[1]!);
    if (itemsDup.length === 0) return null;
    if (itemsDup.length === 1) return itemsDup[0][1];
    const mid = Math.floor((itemsDup.length - 1) / 2);
    if (itemsDup.length % 2 === 1) return itemsDup[mid][1];

    return (itemsDup[mid][1]! + itemsDup[mid + 1][1]!) / 2;
  }

  private _delta(items: EntityCachePoints): number | null {
    const max = this._maximum(items);
    const min = this._minimum(items);
    return max === null || min === null ? null : max - min;
  }

  private _diff(items: EntityCachePoints): number | null {
    const noNulls = this._filterNulls(items);
    const first = this._first(noNulls);
    const last = this._last(noNulls);
    if (first === null || last === null) {
      return null;
    }
    return last - first;
  }

  private _filterNulls(items: EntityCachePoints): EntityCachePoints {
    return items.filter((item) => item[1] !== null);
  }

  private async _fetchHistory(start: Date, end: Date): Promise<EntityCachePoints | undefined> {
    try {
      const hist = await this._fetchRecent(start, end, false);
      // Ensure hist and hist[0] are valid before accessing length
      if (!hist || !Array.isArray(hist) || hist.length === 0) return [];
      if (!Array.isArray(hist[0])) return [];
      const minLength = 1;
      if (hist[0].length < minLength) return [];

      let lastState: unknown = hist[0][0].state;
      let lastNonNullState: number | null = null;
      const history: EntityCachePoints = hist[0].map((item: HassHistoryEntry) => {
        // Explicitly type item
        // Use optional chaining for attribute access
        const stateValue = this._config.attribute ? item.attributes?.[this._config.attribute] : item.state;
        const [state, lastNonNull] = this._transformAndFill(stateValue, item, lastNonNullState);
        lastState = item.state; // Update lastState for fill_raw: last
        lastNonNullState = lastNonNull;
        const date = new Date(item.last_changed);
        const timestamp = date.getTime();
        return [timestamp, state];
      });

      // Fill start
      if (this._config.group_by.start_with_last && history.length > 0) {
        const value = history[0][1];
        history.unshift([start.getTime(), value]);
      }

      // fill end
      if (history.length > 0 && this._config.extend_to) {
        const value =
          this._config.fill_raw === 'last'
            ? this._transformAndFill(lastState, hist[0][hist[0].length - 1], lastNonNullState)[0]
            : this._config.fill_raw === 'zero'
              ? 0
              : null;
        history.push([end.getTime(), value]);
      }
      return history;
    } catch (err) {
      console.error(`Error in _fetchHistory for ${this._entityID}:`, err);
      // Return empty array instead of throwing
      return [];
    }
  }

  private _processHistory(
    oldHistory: EntityCachePoints,
    newHistory: EntityCachePoints,
    _start: Date, // Mark as unused
    _end: Date, // Mark as unused
  ): EntityCachePoints {
    if (!newHistory || newHistory.length === 0) {
      return oldHistory || [];
    }

    let processedHistory = oldHistory ? [...oldHistory] : [];

    // Remove points from old history that are within the new history's time range
    const firstNewTimestamp = newHistory[0][0];
    processedHistory = processedHistory.filter((point) => point[0] < firstNewTimestamp);

    // Append new history
    processedHistory.push(...newHistory);

    // Sort by timestamp (just in case)
    processedHistory.sort((a, b) => a[0] - b[0]);

    // Remove duplicate timestamps (keeping the latest entry)
    processedHistory = processedHistory.filter(
      (point, index, self) => index === self.findIndex((p) => p[0] === point[0]),
    );

    return processedHistory;
  }
}
