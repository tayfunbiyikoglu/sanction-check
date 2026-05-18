# Keep extraction correction source-backed and parser-owned

Users may correct extracted field values and add missed records only when those corrections are backed by official source evidence from the candidate legal act. False-positive records, incorrect action types, and incorrect person/entity classifications require parser or rule fixes followed by candidate reprocessing; this makes correction slower than free-form editing, but keeps exports reproducible and prevents the UI from hiding extraction defects.
