# id-mystery-machine

A fork of iD with some extra features for validation, load/save of custom xml datasets, and review tools.

![alt text](https://raw.githubusercontent.com/osmlab/id-mystery-machine/master/iD_2.3.0/docs/img/mystery-machine.gif)

## About
This fork of the [iD editor](https://github.com/openstreetmap/iD) is designed to support loading machine-generated XML files and doing human editing/submission upon that. Some of these features may be useful to support the general iD mapping workflow for the whole OSM mapper community. We provide a brief introduction to these features below, as well as key code pointers. Surrounding changes in css, data, and relevant .js files can be inferred by following these key pointers.

### Error detection on road features
* Useful for preventing simple mistakes when editing roads.
* Code pointers:
  - modules/core/context.js : “function refillErrorList”
  - modules/ui/inspector.js : “footer.selectAll('.footer-error-bar')”
  - modules/ui/next_error.js
  - modules/ui/previous_error.js

### Hot keys for changing road type
* Useful for quick road type assignment.
* Code pointers:
  - modules/actions/change_tags_batch.js
  - modules/operations/batch_road_tagging.js

### 'No fill' option that disables rendering of all map features
* Useful for purely checking what's on satellite imagery.
* Code pointers:
  - modules/ui/map_data.js : “fills = \['none'”

### Option for only load data within a bounding box
* Useful for mapping a bounding-box task from Tasking Manager. It also draws grids within the area to map.
* Code pointers:
  - modules/renderer/map.js : “function drawMapBounds”
  - modules/core/context.js : “context.editInBoundsMode = function”
  - modules/services/osm.js : “loadInBounds: function”
  - modules/ui/background.js : “function drawGridsOptionList”
  - modules/ui/gridfocus.js

### Loop through imagery with 'CMD + B'
* Useful for quickly switching background imagery.
* Code pointers:
  - modules/ui/background.js : “.on(uiCmd('\u2318' + key), rotateBackgroundSource)”

### Hot key to highlight currently edited roads
* Useful for checking which roads have been changed.
* Code pointers:
  - modules/core/history.js : “newGraph = autoTagging(prevGraph, newGraph)”
  - modules/svg/tag_classes.js : “classes += ' tag-edited'”
  - modules/ui/map_data.js : “function toggleHighlightEdited”
  - data/discarded.json : “edited”

### Show negative road ID in lower-left corner and support search on negative feature ID
* Useful for road searching.
* Code pointers:
  - modules/behavior/hash.js : “var selected = context.selectedIDs”
  - modules/core/context.js : “context.zoomToEntity = function”
  - modules/ui/feature_list.js : “var idMatch = q.match”
  - modules/ui/view_on_osm.js : “if (entity.isNew())”

### Save current data in graph to local file
* Useful for generating offline XML files.
* Code pointers:
  - modules/core/context.js : “context.genXMLStringFromGraph = function”
  - modules/ui/save_local.js

### Keeping positive nodes on positive ways on connect/disconnect
* Useful for reducing unnecessary updates sent to OSM server.
* Code pointers:
  - modules/actions/connect.js : “if (lastNid[1] === '-') {”
  - modules/actions/disconnect.js : “if (nodeId[1] !== '-' && candidates.length > 1”
