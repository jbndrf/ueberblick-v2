# Exporting a person's data

When someone asks what your project holds about them (GDPR Art. 15) or wants their data in a usable format (Art. 20), you export it as one ZIP file. Answer within one month.

What you need: the person's participant ID, or, for a feature that is about a person (`personal: { subject: feature }`), the feature ID. Mark personal properties first (see *Personal data in your project*).

## What the ZIP contains

- `participant.json`: name, roles and attributes of the participant
- `runs.ndjson`: every change the person submitted, including refused ones
- `messages.ndjson`: the person's chat messages and the messages that mention them or an object concerning them (`via`: `author` or `mentioned`)
- `observations.ndjson`: every value they entered, with earlier versions, plus values about them that others entered in personal properties
- `features.geojson`: the affected features (map data, RFC 7946)
- `blobs/`: their attachments (photos, files), named by checksum
- `manifest.json`: the list of files, the config version and the names of the personal properties, so the files can be read without the app

`.ndjson` files hold one JSON object per line and open in any text editor or data tool. Data of other people on the same feature is not included.

Values that others entered in a personal property naming the person (`property:<key>`) are included for the time that person was named in that property.

What the person entered about someone else is not handed out. If they wrote a personal value that belongs to another person (for example a contact number in a property naming a colleague), that value is missing from `observations.ndjson`, and in `runs.ndjson` it is replaced by `{ "$redacted": "other_subject" }`, so the file shows that something was left out. In a refused change, where nothing shows whom a personal value is about, the value is replaced the same way.

## Good to know

- Every export is logged with your account, the person's ID and the time. The log holds no values.
- Attachments that are no longer stored are listed under `missing_blobs` in the manifest.
- The export is a read. It changes nothing; to erase the data, use the erasure task (separate).
- A screen for this is planned; until then your server operator triggers the export.
