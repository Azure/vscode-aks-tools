# Detector Renderer Components

This folder contains renderers for each `type` of `dataset`.

The output of a detector is structured like:

```json
{
  "properties": {
    "dataset": [
      {
        "renderingProperties": {
          "type": 7
        },
        "table": {
          "columns": [...],
          "rows": [...]
        }
      },
      // ...
    ],
    // ...
  },
  // ...
}
```

I.e. it contains a collection of `dataset`s, each of which contain metadata about how they are rendered. Specifically, they contain a `renderingProperties.type` value,
which informs how the data in the `table` structure should be rendered.

Some common types are:
- 7 ("insights"): A status value and message, with zero or more name/value pairs of extra data.
- 9 ("markdown"): One or more blobs of markdown.
- 2 ("time series"): Numeric data over time, to be rendered as a chart.
- 10 ("detector"): Used in 'category' detectors - contains no data, just references to other detectors.
