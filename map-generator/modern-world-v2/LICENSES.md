# Modern regions v2 data rights and pinned provenance

This directory is a collection of separately licensed source databases. The
programs that preprocess or run the game retain the repository's AGPL-3.0
license. Licensing a database does not replace the game's source-code license.

`src/core/game/ModernRegionsData.json`, `owners.raw`, `factions.csv`, the generated
administrative grouping and their Russian/Canadian derived boundary contents
are made available under the **Open Database License (ODbL) 1.0**:
<https://opendatacommons.org/licenses/odbl/1-0/>. The complete machine-readable
derived data, exact original inputs and preprocessing algorithm are committed
to this public fork. The separate climatology contents retain CC BY 4.0; the
Natural Earth contents remain public domain. No rights over third-party
contents are asserted beyond those granted by their original licenses.

Contains information from OpenStreetMap contributors / Wambacher via
geoBoundaries RUS ADM2, and Statistics Canada via geoBoundaries CAN ADM3,
available under the Open Database License. Source metadata records are kept
unchanged, including the Canadian source's additional Statistics Canada Open
License Agreement notice: <https://www.statcan.gc.ca/en/reference/licence>.

| Input                               | Pinned version / represented date                                                                     | Source and original license                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Parent ownership / countries        | Existing modern-world v1, Natural Earth 5.1.1 50m                                                     | Natural Earth public domain, inherited unchanged                                                              |
| `ne-admin1-5.1.1.zip`               | Natural Earth 5.1.1 10m ADM1                                                                          | <https://naturalearth.s3.amazonaws.com/5.1.1/10m_cultural/ne_10m_admin_1_states_provinces.zip>, public domain |
| `ne-ports-5.1.2.zip`                | Natural Earth release 5.1.2 archive, **port component 5.0.0** as recorded by the original VERSION.txt | <https://naturalearth.s3.amazonaws.com/5.1.2/10m_cultural/ne_10m_ports.zip>, public domain                    |
| RUS ADM2                            | geoBoundaries commit `9469f09`, 2017                                                                  | OpenStreetMap / Wambacher, ODbL 1.0                                                                           |
| AUS ADM2                            | geoBoundaries commit `9469f09`, 2022                                                                  | Source attribution in unchanged metadata, CC BY 4.0                                                           |
| BRA ADM2                            | geoBoundaries commit `9469f09`, 2020                                                                  | Source attribution in unchanged metadata, CC BY 3.0 IGO                                                       |
| CAN ADM2                            | geoBoundaries commit `9469f09`, 2022                                                                  | Source attribution in unchanged metadata, Open Government Canada 2.0                                          |
| CAN ADM3                            | geoBoundaries commit `9469f09`, 2016                                                                  | Statistics Canada; metadata ODbL 1.0 / Statistics Canada Open License Agreement                               |
| CHN ADM2                            | geoBoundaries commit `9469f09`, 2017                                                                  | Source attribution in unchanged metadata, PDDL 1.0                                                            |
| USA ADM2                            | geoBoundaries commit `9469f09`, 2018                                                                  | Source attribution in unchanged metadata, public domain                                                       |
| `koppen-1991-2020-0p1.tif` / legend | Figshare article `21789074` version 1, file `45057352`, historical period 1991–2020                   | Beck et al. (2023), CC BY 4.0                                                                                 |

geoBoundaries attribution: William & Mary geoLab, geoBoundaries Global
Administrative Database, <https://www.geoboundaries.org/>, together with each
record's `boundarySource`, `boundarySourceURL`, `boundaryLicense` and
`licenseSource`. Original simplified GeoJSON response bytes are stored using
lossless gzip with timestamp zero. A gzip container changes no source geometry.
The full original source IDs are preserved in each faction's `adminUnits`.

Climate attribution: Hylke E. Beck, Tim R. McVicar, Noemi Vergopolan, Alexis Berg,
Nicholas Lutsko, Ambroise Dufour, Zhenzhong Zeng, Xin Jiang, Albert van Dijk and
Diego Miralles (2023), _High-resolution (1 km) Köppen-Geiger maps for 1901–2099
based on constrained CMIP6 projections_, Scientific Data 10, 724.
<https://doi.org/10.1038/s41597-023-02549-6>.
Dataset <https://doi.org/10.6084/m9.figshare.21789074.v1>,
license <https://creativecommons.org/licenses/by/4.0/>.
Changes: historical 0.1° classification sampled to 2000×1000 Plate Carrée,
30 source classes aggregated to five major climate classes; missing coastal
land samples use the nearest measured source land cell. No weather is inferred.

Natural Earth reuse terms: <https://www.naturalearthdata.com/about/terms-of-use/>.
Natural Earth ADM1 boundaries are generalized and reflect the dataset's
de-facto policy; this scenario does not make a statement of recognition.

Port names and locations are historical source facts. The game's major-port
selection uses source scale rank ≤5 plus the named Korean/Russian/Indian
locations in `policy.json`; it is not a ranking by current throughput, a
complete global port catalogue, or a navigational product. The NGA service was
not incorporated because its TLS chain could not be validated in this
environment. No real-time request is required at game start.
