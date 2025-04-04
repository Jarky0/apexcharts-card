# Using Statistics in ApexCharts Card

This guide provides step-by-step instructions on how to add and configure a new series using the built-in `statistics` feature in the ApexCharts Card for Home Assistant.

## Introduction

The `statistics` feature allows you to use Home Assistant's long-term statistics instead of the regular state history to display data in your charts. This provides several advantages:

- **Improved Performance**: More efficient for displaying data over long time periods
- **Data Aggregation**: Pre-calculated statistical values (mean, min, max, etc.)
- **Lower Resource Usage**: Reduces the load on your Home Assistant instance
- **Consistent Data Points**: Evenly spaced data points for cleaner charts

## Basic Configuration

### Step 1: Add a Basic ApexCharts Card

Start with a basic ApexCharts Card configuration:

```yaml
type: custom:apexcharts-card
graph_span: 24h
header:
  show: true
  title: My Statistics Chart
series:
  - entity: sensor.temperature
```

### Step 2: Add Statistics Configuration

Modify your series to use the `statistics` feature:

```yaml
type: custom:apexcharts-card
graph_span: 24h
header:
  show: true
  title: My Statistics Chart
series:
  - entity: sensor.temperature
    statistics:
      type: mean
      period: hour
```

This configuration will show the hourly mean temperature values for the last 24 hours.

## Configuration Options

The `statistics` object supports the following properties:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | string | `mean` | Type of statistical calculation to use (`mean`, `min`, `max`, `sum`, `state`, `change`) |
| `period` | string | `hour` | Time period for aggregation (`5minute`, `hour`, `day`, `week`, `month`) |
| `align` | string | `middle` | How to align data points within the period (`start`, `end`, `middle`) |

### Statistical Types

- **mean**: Average value during the period
- **min**: Minimum value recorded during the period
- **max**: Maximum value recorded during the period
- **sum**: Sum of all values during the period (useful for consumption metrics)
- **state**: Last state recorded during the period
- **change**: Amount of change during the period (useful for increasing values)

### Period Options

- **5minute**: Data points every 5 minutes
- **hour**: Hourly data points
- **day**: Daily data points
- **week**: Weekly data points
- **month**: Monthly data points

### Alignment Options

- **middle**: Data points are aligned to the middle of each period
- **start**: Data points are aligned to the start of each period
- **end**: Data points are aligned to the end of each period

## Example Use Cases

### Example 1: Temperature Monitoring with Hourly Averages

```yaml
type: custom:apexcharts-card
graph_span: 24h
header:
  show: true
  title: Temperature (Hourly Average)
series:
  - entity: sensor.temperature
    statistics:
      type: mean
      period: hour
```

### Example 2: Daily Min/Max Temperature Comparison

```yaml
type: custom:apexcharts-card
graph_span: 7d
header:
  show: true
  title: Weekly Temperature Range
series:
  - entity: sensor.temperature
    name: Maximum Temperature
    color: red
    statistics:
      type: max
      period: day
  - entity: sensor.temperature
    name: Minimum Temperature
    color: blue
    statistics:
      type: min
      period: day
```

### Example 3: Energy Consumption (Daily Total)

```yaml
type: custom:apexcharts-card
graph_span: 30d
header:
  show: true
  title: Daily Energy Consumption
series:
  - entity: sensor.energy_consumption
    type: column
    statistics:
      type: sum
      period: day
```

### Example 4: Different Alignments

```yaml
type: custom:apexcharts-card
graph_span: 7d
header:
  show: true
  title: Temperature with Different Alignments
series:
  - entity: sensor.temperature
    name: Start Aligned
    statistics:
      type: mean
      period: day
      align: start
  - entity: sensor.temperature
    name: End Aligned
    statistics:
      type: mean
      period: day
      align: end
```

## Advanced Configuration

### Combining with Other Series Options

You can combine the `statistics` configuration with other series options like `color`, `type`, `name`, etc.:

```yaml
type: custom:apexcharts-card
graph_span: 30d
header:
  show: true
  title: Advanced Statistics Example
series:
  - entity: sensor.temperature
    name: Temperature (Daily Average)
    color: orange
    stroke_width: 2
    type: area
    opacity: 0.5
    statistics:
      type: mean
      period: day
```

### Using with Transform

You can apply transformations to your statistical data:

```yaml
type: custom:apexcharts-card
graph_span: 30d
header:
  show: true
  title: Transformed Statistics
series:
  - entity: sensor.temperature
    name: Temperature (°F)
    statistics:
      type: mean
      period: day
    transform: return x * 9/5 + 32;
```

## Important Notes

1. When using `statistics`, the following options are ignored if specified:
   - `group_by` (including all sub-properties)
   - `fill_raw`

2. Statistics require that your entity has long-term statistics enabled in Home Assistant.

3. For best results, match your `graph_span` with the chosen `period`:
   - For `period: hour`, use `graph_span: 24h` or similar
   - For `period: day`, use `graph_span: 7d` or similar
   - For `period: week`, use `graph_span: 4w` or similar
   - For `period: month`, use `graph_span: 6M` or similar

## Troubleshooting

- **No Data Appears**: Ensure your entity has long-term statistics enabled in Home Assistant
- **Missing Data Points**: Check that your entity has been recording data for the entire selected time span
- **Unexpected Values**: Verify that the statistical type (`mean`, `max`, etc.) matches your needs

## Examples Gallery

### Daily Energy Usage Bar Chart

```yaml
type: custom:apexcharts-card
graph_span: 14d
header:
  show: true
  title: Daily Energy Usage
series:
  - entity: sensor.energy_consumption
    type: column
    name: Energy Usage
    statistics:
      type: sum
      period: day
yaxis:
  - min: 0
    apex_config:
      forceNiceScale: true
```

### Weekly Summary with Multiple Metrics

```yaml
type: custom:apexcharts-card
graph_span: 60d
header:
  show: true
  title: Weekly Environmental Metrics
series:
  - entity: sensor.temperature
    name: Avg Temperature
    statistics:
      type: mean
      period: week
  - entity: sensor.humidity
    name: Avg Humidity
    statistics:
      type: mean
      period: week
    yaxis_id: humidity
yaxis:
  - id: humidity
    opposite: true
    min: 0
    max: 100
    unit: "%"
```