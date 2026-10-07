# Geometry and coordinate systems

Überblick stores every geometry in **WGS84** (longitude/latitude, 7 decimals, about 1 cm). Heights (Z) are kept.

## Import
On import you declare the **source coordinate system**: GeoPackage and GeoJSON files with a `crs` member carry it; for CSV you choose it. Supported:

- EPSG:25832 and EPSG:25833 (ETRS89 / UTM, the German defaults)
- EPSG:31466 to EPSG:31469 (Gauss-Krueger, zones 2 to 5)
- EPSG:4258 (ETRS89 geographic) and EPSG:4326 (WGS84)

## Checking and repair
Every geometry is checked. Possible findings: empty, invalid number, out of range, too few points, ring not closed, self-intersection, hole outside its area, overlapping parts. Wrong ring direction and open rings are fixed automatically; self-intersections and overlapping parts are repaired where possible. Anything that cannot be repaired is reported with its finding.

## Computed values
For each geometry Überblick computes the bounding box, a **point on the surface** (for markers and labels; always inside the area), the area centroid (analytics only), the area in m² and the length in m (measured on the ellipsoid).
