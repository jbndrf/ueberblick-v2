# Map tiles and data protection (tile proxy)

The map pictures (OpenStreetMap, a WMS, your own tile URL, a PMTiles file) do not come from the provider to the participant's phone. The server fetches them and passes them on. The provider sees only your server, never a participant's IP address or browser. Without this, every map view would tell the provider where your team is working, which is a data-protection problem.

## What it does for you
- **Nothing to set up.** You enter the layer's address in the project file as before (`map.layers.<layer>.source`). The server uses it.
- **Faster and cheaper.** The server keeps the pictures it has fetched (up to 2 GB, at most 30 days). The second person who views the same area gets them from the server, and the provider is asked once.
- **Polite to the provider.** The server sends the name `Überblick/4 (+<PUBLIC_URL>)` and your public address, so the provider can contact you, as the OpenStreetMap tile policy asks. It asks each provider for at most 2 pictures at a time and 10 per second, waits when the provider asks it to slow down, and tries again a few times when it fails.
- **Same visibility as the layer.** Whoever may not see a layer (`roles` of the layer) cannot fetch its pictures either.
- **A changed address starts fresh.** If you change a layer's address, the pictures of the old address are not used any more.

- **Only public addresses.** The server refuses to fetch a layer from your own server or from a private network (addresses such as 10.x, 192.168.x, 127.x or 169.254.x), also when a name or a redirect leads there. Such a layer shows no pictures and, in an offline pack, fails with that reason. Use a public address for the layer.
- **Layers on your own server.** A layer address that starts with `/` (a path on this server, for example `/tiles/town.pmtiles`) is not fetched by the proxy: the map loads it directly, because it never leaves your server. An offline pack of such a layer is built from your own server's public address. A tile your server does not have is simply left out of the pack. An address that starts with `//` (or `/\`) names another host and is treated like any other internet address.

## Offline packs
Offline packs of OpenStreetMap layers and of layers with a tile URL are possible now: the server builds the pack from the same pictures and keeps them, so the next view of that area also needs no request to the provider. WMS and GeoJSON layers cannot go into a pack. Because OpenStreetMap asks not to download maps in bulk, a pack may hold at most 10,000 tiles of a layer from the OpenStreetMap servers. If it is bigger, the build stops with the reason; make the area or the zoom range smaller.

## For operators
- The pictures are in the data folder under `tiles-cache`. You can delete the folder at any time; it fills up again. It does not need a backup.
- Layers that load from a URL on the internet need that address reachable from the server, not from the participants' phones.
- Technical reference: `docs/decisions/later/A-033-tile-proxy.md`.
