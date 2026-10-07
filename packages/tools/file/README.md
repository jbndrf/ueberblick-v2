# @ueberblick/tool-file

A `field` tool for `file` properties (WP-658): v3's "Dateien" button (`MediaGallery.svelte:303-336`). Pick files of any type the property accepts (the picker offers v3's default image types when `accept` is empty), the bytes go unchanged to the blob port, the tool produces `[{sha256, name, mime}]` appended to the current list up to `max_files`. A field selects it with `tool: file`. The file list and the remove buttons are drawn by the form's gallery above the field; the tool is the button and a status line. No settings. Strings in `messages/{en,de}.json` (`file_*`).
