import * as d3 from 'd3';
import _ from 'lodash';
import { t, currentLocale, addTranslation, setLocale } from '../util/locale';
import { coreHistory } from './history';
import { dataLocales, dataEn } from '../../data/index';
import { modeSelect } from '../modes/select';
import { presetIndex } from '../presets/index';
import { rendererBackground } from '../renderer/background';
import { rendererFeatures } from '../renderer/features';
import { rendererMap } from '../renderer/map';
import { services } from '../services/index';
import { uiInit } from '../ui/init';
import { uiLoading } from '../ui';
import { utilDetect } from '../util/detect';
import { utilRebind, utilStringQs, isObjectEmptyWithProto } from '../util';
import {
    geoRawMercator,
    geoExtent,
    geoExtentFromBounds,
    geoLineIntersection,
    geoSphericalDistance,
    geoWayLength,
} from '../geo';
import { osmEntity } from '../osm';
import {
    actionAddNegEntities,
    actionAutoConnect,
    actionMergePosWayFromXML,
    actionMergePosNodeFromXML,
    posNodeManuallyChanged
} from '../actions';

export var areaKeys = {};

export function setAreaKeys(value) {
    areaKeys = value;
}


export function coreContext() {
    var context = {};
    context.version = '2.3.0';

    // create a special translation that contains the keys in place of the
    // strings
    var tkeys = _.cloneDeep(dataEn);
    var parents = [];

    function traverser(v, k, obj) {
        parents.push(k);
        if (_.isObject(v)) {
            _.forOwn(v, traverser);
        } else if (_.isString(v)) {
            obj[k] = parents.join('.');
        }
        parents.pop();
    }

    _.forOwn(tkeys, traverser);
    addTranslation('_tkeys_', tkeys);

    addTranslation('en', dataEn);
    setLocale('en');

    var dispatch = d3.dispatch('enter', 'exit', 'change');

    // https://github.com/openstreetmap/iD/issues/772
    // http://mathiasbynens.be/notes/localstorage-pattern#comment-9
    var storage;
    try { storage = localStorage; } catch (e) {} // eslint-disable-line no-empty
    storage = storage || (function() {
        var s = {};
        return {
            getItem: function(k) { return s[k]; },
            setItem: function(k, v) { s[k] = v; },
            removeItem: function(k) { delete s[k]; }
        };
    })();

    context.storage = function(k, v) {
        try {
            if (arguments.length === 1) return storage.getItem(k);
            else if (v === null) storage.removeItem(k);
            else storage.setItem(k, v);
        } catch (e) {
            // localstorage quota exceeded
            /* eslint-disable no-console */
            if (typeof console !== 'undefined')
                console.error('localStorage quota exceeded');
            /* eslint-enable no-console */
        }
    };


    /* Straight accessors. Avoid using these if you can. */
    var ui, connection, history;
    context.ui = function() { return ui; };
    context.connection = function() { return connection; };
    context.history = function() { return history; };


    /* Connection */
    function entitiesLoaded(err, result) {
        if (!err) history.merge(result.data, result.extent);
    }

    context.preauth = function(options) {
        connection.switch(options);
        return context;
    };

    context.loadTiles = function(projection, dimensions, callback) {
        function done(err, result) {
            entitiesLoaded(err, result);
            if (callback) callback(err, result);
        }
        connection.loadTiles(projection, dimensions, done);
    };

    // load more data around the mapBounds to help with autoconnect
    // 0.002 degree at equator is ~222 meters
    var mapBoundsBuffer = 0.002;
    context.loadInBounds = function(mapBounds, callback) {
        function done(err, result) {
            if (err) {
                window.alert(t('osm_file.error_live') + '\n' + err);
                return;
            }
            if (!err && context.focusOnRoads()) {
                result.data = Object.values(entsRelatedToRoads(result.data));
            }
            entitiesLoaded(err, result);
            if (callback) callback(err, result);
        }
        if (context.mapperRole() === context.EDITOR_ROLE &&
            context.editInBoundsMode() === context.EDIT_IN_BOUNDS_FROM_OSM_XML)
        {
            mapBoundsBuffer = 0;
        }
        connection.loadInBounds({
          minlon: mapBounds.minlon - mapBoundsBuffer,
          minlat: mapBounds.minlat - mapBoundsBuffer,
          maxlon: mapBounds.maxlon + mapBoundsBuffer,
          maxlat: mapBounds.maxlat + mapBoundsBuffer,
        }, done);
    };

    // extract highways, waterways, railways, and building ways from entities
    function entsRelatedToRoads(entities) {
        if (Array.isArray(entities)) {
            entities = entitiesArrayToObject(entities);
        }
        var results = {};
        for (eid in entities) {
            if (eid[0] !== 'w') continue;
            var way = entities[eid];
            if (!way) continue;
            if (!(way.tags.highway || way.tags.building ||
                  way.tags.railway || way.tags.waterway)) {
                continue;
            }
            results[eid] = way;
            way.nodes.forEach(function(nid) {
                if (entities[nid] && !results[nid]) {
                    results[nid] = entities[nid];
                }
            });
        }
        return results;
    }

    context.loadEntity = function(id, callback) {
        function done(err, result) {
            entitiesLoaded(err, result);
            if (callback) callback(err, result);
        }
        connection.loadEntity(id, done);
    };

    context.zoomToEntity = function(id, zoomTo) {
        map.on('drawn.zoomToEntity', function() {
            if (!context.hasEntity(id)) return;
            map.on('drawn.zoomToEntity', null);
            context.on('enter.zoomToEntity', null);
            context.enter(modeSelect(context, [id]));
        });

        context.on('enter.zoomToEntity', function() {
            if (mode.id !== 'browse') {
                map.on('drawn.zoomToEntity', null);
                context.on('enter.zoomToEntity', null);
            }
        });

        if (context.editInBoundsMode() === context.EDIT_IN_BOUNDS_FROM_OSM_XML)
        {
            if (context.hasEntity(id)) map.zoomTo(context.entity(id));
        } else {
            if (zoomTo !== false) {
                this.loadEntity(id, function(err, result) {
                    if (err) return;
                    var entity = _.find(
                        result.data, function(e) { return e.id === id; });
                    if (entity) { map.zoomTo(entity); }
                });
            }
        }
    };

    var minEditableZoom = 16;
    context.minEditableZoom = function(_) {
        if (!arguments.length) return minEditableZoom;
        minEditableZoom = _;
        connection.tileZoom(_);
        return context;
    };

    /* Logics for mapper role in a 2-stage submission process */
    var mapperRole = null;
    context.EDITOR_ROLE = 'editor';
    context.REVIEWER_ROLE = 'reviewer';
    context.mapperRole = function() {
        if (mapperRole !== null) return mapperRole;
        if (context.initialURLParams.mapper_role === context.EDITOR_ROLE ||
            context.initialURLParams.mapper_role === context.REVIEWER_ROLE) {
            mapperRole = context.initialURLParams.mapper_role;
        } else if (context.editInBoundsMode() ===
            context.EDIT_IN_BOUNDS_FROM_OSM_XML) {
            // when working on OSM XML files, default to editor role
            mapperRole = context.EDITOR_ROLE;
        } else {
            mapperRole = context.REVIEWER_ROLE;
        }
        return mapperRole;
    };

    /* Logics for loading entities within bounds or from XML files */

    var editInBoundsMode = null;
    context.NOT_EDIT_IN_BOUNDS = 0;
    context.EDIT_IN_BOUNDS_FROM_URL_PARAM = 1;
    context.EDIT_IN_BOUNDS_FROM_OSM_XML = 2;
    context.editInBoundsMode = function() {
        if (editInBoundsMode !== null) return editInBoundsMode;

        if (!context.initialURLParams.hasOwnProperty('edit_in_bounds')) {
            editInBoundsMode = context.NOT_EDIT_IN_BOUNDS;
        } else if (context.initialURLParams.edit_in_bounds === 'from_osm_xml') {
            editInBoundsMode = context.EDIT_IN_BOUNDS_FROM_OSM_XML;
        } else {
            editInBoundsMode = context.EDIT_IN_BOUNDS_FROM_URL_PARAM;
        }

        if (editInBoundsMode !== context.NOT_EDIT_IN_BOUNDS) {
            context.minEditableZoom(13);
        }
        return editInBoundsMode;
    }

    var mapBounds = null;
    context.getMapBounds = function() {
        // look for "edit_in_bounds=<minlon>,<minlat>,<maxlon>,<maxlat>" in URL
        if (mapBounds === null &&
            context.editInBoundsMode() ===
            context.EDIT_IN_BOUNDS_FROM_URL_PARAM) {
            var mapBoundsStr = context.initialURLParams.edit_in_bounds,
                boundsParts = mapBoundsStr.split(',');
            mapBounds = {
                minlon: parseFloat(boundsParts[0]),
                minlat: parseFloat(boundsParts[1]),
                maxlon: parseFloat(boundsParts[2]),
                maxlat: parseFloat(boundsParts[3])
            };
            // It turns out in case of bad bounds string Javascript will let the
            // above codes go without throwing any exception. The only way to
            // detect is to search for NaN in the parsed object.
            if (!isMapBoundsValid(mapBounds)) {
                window.alert(t('edit_in_bounds.bad_url_param'));
            }
        }

        return isMapBoundsValid(mapBounds) ? mapBounds : null;
    };

    function isMapBoundsValid(mapBounds) {
        if (mapBounds === null || mapBounds === undefined) return false;
        if (isNaN(mapBounds.minlon) || isNaN(mapBounds.minlat) ||
            isNaN(mapBounds.maxlon) || isNaN(mapBounds.maxlat)) {
            return false;
        }
        return true;
    }

    context.DATA_IN_BOUNDS_NOT_LOADING = 0;
    context.DATA_IN_BOUNDS_LOADING = 1;
    context.DATA_IN_BOUNDS_LOADED = 2;

    var dataInBoundsLoadState = context.DATA_IN_BOUNDS_NOT_LOADING;
    context.dataInBoundsLoadState = function(_) {
        if (!arguments.length) return dataInBoundsLoadState;
        dataInBoundsLoadState = _;
        return context;
    };

    context.restoreDisabled = function() {
        return context.initialURLParams.disable_restore === 'true';
    };

    // when focus_on_roads=true is set, we'll only load highway, waterway,
    // building, and railways from XML file and live OSM data
    context.focusOnRoads = function() {
        return context.initialURLParams.focus_on_roads === 'true';
    };

    var osmFileName = null;
    context.osmFileName = function(_) {
        if (!arguments.length) return osmFileName;
        osmFileName = _;
        return context;
    };

    var osmXMLEntities = null;
    context.osmXMLEntities = function() {
        return osmXMLEntities;
    };

    function entitiesArrayToObject(entities) {
        var obj = {};
        _.each(entities, function(ent) {
            obj[ent.id] = ent;
        });
        return obj;
    }

    context.osmXMLLoadedFromFile = function(xmlFile, bounds, entities, err) {
        if (err) {
            window.alert(t('osm_file.error_file') + '\n' + err);
            context.closeOSMLoadingMsg();
        } else {
            mapBounds = bounds;
            osmFileName = xmlFile.name;
            osmXMLEntities = context.focusOnRoads()
                ? entsRelatedToRoads(entities)
                : entitiesArrayToObject(entities);
            context.loadInBoundsFromOSMServer();
        }
    };

    // Data from the 'base' version of the XML file. E.g. if osmXMLEntities are
    // loaded from 'editor' or 'reviewer' version XML file, osmXMLEntitiesBase
    // would be data loaded from the 'machine' version. This is useful for
    // detecting if an entity has been changed manually in the 'editor' or
    // 'reviewer' version of XML file.
    var osmXMLEntitiesBase = null;
    context.osmXMLEntitiesBase = function() {
        return osmXMLEntitiesBase;
    }

    context.osmXMLLoadedFromURL = function(url, bounds, entities, err) {
        if (err) {
            window.alert(t('osm_file.error_url') + '\n' + err);
            context.closeOSMLoadingMsg();
        } else {
            mapBounds = bounds;
            osmFileName = url.substring(url.lastIndexOf("/") + 1);
            osmXMLEntities = context.focusOnRoads()
                ? entsRelatedToRoads(entities)
                : entitiesArrayToObject(entities);
            var machineUrl = url.indexOf('/editor/') >= 0
                ? url.replace('editor', 'machine')
                : (url.indexOf('/reviewer/') >= 0
                    ? url.replace('reviewer', 'machine')
                    : null);
            if (machineUrl === null) {
                context.loadInBoundsFromOSMServer();
            } else {
                connection.loadXMLFromURL(
                    machineUrl,
                    function(_url, _bounds, machineEnts, machineErr) {
                        if (machineErr) {
                            window.alert(t('osm_file.error_machine_url') + '\n'
                                + machineErr);
                        } else {
                            osmXMLEntitiesBase = context.focusOnRoads()
                                ? entsRelatedToRoads(machineEnts)
                                : entitiesArrayToObject(machineEnts);
                        }
                        context.loadInBoundsFromOSMServer();
                    }
                );
            }
        }
    };

    context.loadInBoundsFromOSMServer = function() {
        if (dataInBoundsLoadState !== context.DATA_IN_BOUNDS_NOT_LOADING ||
            !isMapBoundsValid(mapBounds)) {
            return;
        }

        dataInBoundsLoadState = context.DATA_IN_BOUNDS_LOADING;
        context.showOSMLoadingMsg(t('osm_file.load_live'));
        context.loadInBounds(mapBounds, function(err, result) {
            context.closeOSMLoadingMsg();
            if (osmXMLEntities === null) {
                dataInBoundsLoadState = context.DATA_IN_BOUNDS_LOADED;
                context.map().extent(result.extent);
            } else {
                context.loadMoreEntsToMatchXML();
            }
        });
    }

    context.loadMoreEntsToMatchXML = function() {
        var splitEnts = splitEntitiesFromXML(osmXMLEntities),
            posEnts = splitEnts.pos,
            negEnts = splitEnts.neg,
            posIdsToLoad = [],
            graph = context.graph();

        // first, check if we should try to merge any additional postive
        // entities into history before merging
        for (eid in posEnts) {
            if (!graph.hasEntity(eid)) posIdsToLoad.push(eid);
        }
        if (posIdsToLoad.length === 0) {
            liveDataAllLoadedForXMLMerge(posEnts, negEnts);
            return;
        }
        posIdsToLoad = _.uniq(posIdsToLoad);
        var posIdsLoaded = 0;
        connection.loadMultiple(posIdsToLoad, function(err, result) {
            if (err) {
                window.alert(t('osm_file.error_live') + '\n' + err);
                return;
            }
            entitiesLoaded(err, result);

            // callbacks are sequentially executed in Javascript
            posIdsLoaded += result.data.length;
            if (posIdsLoaded < posIdsToLoad.length) return;

            var lastNidsToLoad = [],
                graph = context.graph();
            posIdsToLoad.forEach(function(eid) {
                if (eid[0] !== 'w' || !graph.hasEntity(eid)) return;
                graph.entity(eid).nodes.forEach(function(nid) {
                    if (!graph.hasEntity(nid)) lastNidsToLoad.push(nid);
                });
            });
            if (lastNidsToLoad.length === 0) {
                liveDataAllLoadedForXMLMerge(posEnts, negEnts);
                return;
            }
            lastNidsToLoad = _.uniq(lastNidsToLoad);
            var lastNidsLoaded = 0;
            connection.loadMultiple(lastNidsToLoad, function(err2, result2) {
                if (err2) {
                    window.alert(t('osm_file.error_live') + '\n' + err2);
                    return;
                }
                entitiesLoaded(err2, result2);
                lastNidsLoaded += result2.data.length;
                if (lastNidsLoaded < lastNidsToLoad.length) return;
                liveDataAllLoadedForXMLMerge(posEnts, negEnts);
            });
        });
    }

    function liveDataAllLoadedForXMLMerge(posEnts, negEnts) {
        context.showOSMLoadingMsg(t('osm_file.merge_xml'));
        fixDeletedPosNodesInNegWays(negEnts, posEnts);
        context.mergeXMlEntsIntoHistory(posEnts, negEnts);
        if (!context.isReadOnlyMode()) {
            context.perform(actionAutoConnect(context));
        }
        refillErrorList();
        context.closeOSMLoadingMsg();
        dataInBoundsLoadState = context.DATA_IN_BOUNDS_LOADED;
        context.allowAutoTagging(true);
        context.map().extent(geoExtentFromBounds(context.getMapBounds()));
    }

    context.mergeXMlEntsIntoHistory = function(posEnts, negEnts) {
        // first, add all negative entities into history
        context.perform(actionAddNegEntities(negEnts),
            t('osm_file.annotations.add_neg_entities'));

        // merge postive ways
        for (var eid in posEnts) {
            var ent = posEnts[eid];
            if (eid[0] === 'w' &&
                (ent.tags.edited || containsNegative(ent.nodes))) {
                context.perform(
                    actionMergePosWayFromXML(
                        eid, osmXMLEntities, osmXMLEntitiesBase
                    ),
                    t('osm_file.annotations.merge_pos_way')
                );
            }
        }

        // merge positive nodes
        for (var eid in posEnts) {
            var ent = posEnts[eid];
            if (eid[0] === 'n' &&
                posNodeManuallyChanged(eid, osmXMLEntities, osmXMLEntitiesBase))
            {
                context.perform(
                    actionMergePosNodeFromXML(
                        eid, osmXMLEntities, osmXMLEntitiesBase
                    ),
                    t('osm_file.annotations.merge_pos_node')
                );
            }
        }
    }

    // Split data from xml files into two sets: negative entities and 'edited'
    // positive entities. Edited postive entities mean entities with 'edited'
    // tag or ways containing negative nodes
    function splitEntitiesFromXML(osmXMLEntities) {
        var posEnts = {},
            negEnts = {},
            posNodesInNegWays = {};
        for (eid in osmXMLEntities) {
            var ent = osmXMLEntities[eid];
            if (eid[1] === '-') {
                negEnts[eid] = ent;
                if (eid[0] === 'w') {
                    addChildNodesToPosEnts(posEnts, ent, osmXMLEntities);
                    addChildNodesToPosEnts(posNodesInNegWays, ent,
                        osmXMLEntities);
                }
            }
        }

        for (eid in osmXMLEntities) {
            var ent = osmXMLEntities[eid];
            if (eid[0] === 'w' && eid[1] !== '-' &&
                (ent.tags.edited || relatedToNegWays(ent, posNodesInNegWays))) {
                posEnts[eid] = ent;
                addChildNodesToPosEnts(posEnts, ent, osmXMLEntities);
            }
        }

        return { pos: posEnts, neg: negEnts };
    }

    function relatedToNegWays(posWay, posEntsInNegWays) {
        var containNegNodes = containsNegative(posWay.nodes),
            containPosNodesInNegWays = _.some(posWay.nodes, function(nid) {
                return nid in posEntsInNegWays;
            });
        return containNegNodes || containPosNodesInNegWays;
    }

    function containsNegative(entIds) {
        return _.some(entIds, function(id) {
            return id[1] === '-';
        });
    }

    // In case any negative ways contain positive nodes that have already been
    // deleted from live OSM data, replace them with negative nodes
    function fixDeletedPosNodesInNegWays(negEnts, posEnts) {
        var minNegID = 0,
            deletedPosNids = new Set(),
            negWidsToUpdate = new Set(),
            graph = context.graph();

        // find positive node IDs deleted in live OSM and their parent ways
        for (eid in negEnts) {
            minNegID = Math.min(minNegID, parseInt(eid.substring(1)));
            if (eid[0] !== 'w') continue;
            negEnts[eid].nodes.forEach(function(nid) {
                if (nid[1] !== '-' && !graph.hasEntity(nid)) {
                    deletedPosNids.add(nid);
                    negWidsToUpdate.add(eid);
                }
            });
        }

        // convert deleted positive nodes into negative ones
        var posNidToNegatedNode = {};
        deletedPosNids.forEach(function(nid) {
            var node = posEnts[nid],
                negNid = 'n' + (--minNegID);

            // negate the node and mark it as a hanging one
            node.id = negNid;
            node.visible = true;
            node.version = undefined;
            node.changeset = undefined;
            node.timestamp = undefined;
            node.user = undefined;
            node.uid = undefined;
            node.tags = {'lint_hanging': 'true'};

            posNidToNegatedNode[nid] = node;
            delete posEnts[nid];
            negEnts[node.id] = node;
        });

        // update references to deleted postive nodes
        negWidsToUpdate.forEach(function(wid) {
            var nodes = negEnts[wid].nodes;
            for (var i = 0; i < nodes.length; i++) {
                if (deletedPosNids.has(nodes[i])) {
                    nodes[i] = posNidToNegatedNode[nodes[i]].id;
                }
            }
        });

        // make sure new entity IDs start from right numbers
        osmEntity.id.next.changeset = --minNegID;
        osmEntity.id.next.node = --minNegID;
        osmEntity.id.next.way = --minNegID;
        osmEntity.id.next.relation = --minNegID;
    }

    function addChildNodesToPosEnts(posEnts, way, entities) {
        _.each(way.nodes, function(nid) {
            if (nid[1] !== '-' && !(nid in posEnts)) {
                posEnts[nid] = entities[nid];
            }
        });
    }

    var uiOSMLoading = null;
    context.showOSMLoadingMsg = function(msg) {
        if (uiOSMLoading !== null) {
            uiOSMLoading.close();
            uiOSMLoading.message(msg);
        } else {
            uiOSMLoading = uiLoading(context).message(msg).blocking(true);
        }
        context.container().call(uiOSMLoading);
    };

    context.closeOSMLoadingMsg = function() {
        if (uiOSMLoading !== null) {
            uiOSMLoading.close();
            uiOSMLoading = null;
        }
    };

    context.checkAndPreloadXML = function() {
        if (context.editInBoundsMode() !==
            context.EDIT_IN_BOUNDS_FROM_OSM_XML) {
            return;
        }
        var preloadURL = context.initialURLParams.preload;
        if (preloadURL) {
            context.showOSMLoadingMsg(t('osm_file.loading'));
            connection.loadXMLFromURL(
                preloadURL,
                context.osmXMLLoadedFromURL
            );
        }
    };

    /* Logics for detecting errors on current entities loaded in graph */
    var errorList = [],
        curErrorIndex = -1;

    context.ERR_TYPE_LINT_TAG = 1;
    context.ERR_TYPE_NOTE_TAG = 2;
    context.ERR_TYPE_SOURCE_TAG = 3;
    context.ERR_TYPE_IMPORT_TAG = 4;
    context.ERR_TYPE_ISO_NODE = 5;
    context.ERR_TYPE_DUPE_NODE = 6;
    context.ERR_TYPE_INVALID_WAY = 7;
    context.ERR_TYPE_SHORT_WAY = 8;
    context.ERR_TYPE_UNCLS_CONNECT = 9;
    context.ERR_TYPE_SELF_INTERSECT = 10;
    context.ERR_TYPE_OVERLAP_WAY = 11;
    context.ERR_TYPE_CROSS_WAY = 12;
    context.ERR_TYPE_LAYER_TAG = 13;
    context.ERR_TYPE_Y_CONNECTION = 14;

    context.ERR_TYPE_MSG = {
        1: 'lint tag',
        2: 'note tag',
        3: 'no source=digitalglobe',
        4: 'no import=yes',
        5: 'isolated node',
        6: 'duplicated node',
        7: 'way with <2 nodes',
        8: 'short road',
        9: 'not connected to major/unclassified',
        10: 'self-intersecting way',
        11: 'overlap with other way',
        12: 'crosses other way',
        13: 'bridge with no layer tag',
        14: 'short edge around connection',
    };

    // these errors are submit-blocking for all editing modes
    var SUBMIT_BLOCKING_ERR = new Set([
        context.ERR_TYPE_LINT_TAG,
        context.ERR_TYPE_ISO_NODE,
        context.ERR_TYPE_DUPE_NODE,
        context.ERR_TYPE_OVERLAP_WAY
    ]);

    // these errors are submit-blocking when edit_in_bounds=from_osm_xml
    var SUBMIT_BLOCKING_ERR_XML = new Set([
        context.ERR_TYPE_LINT_TAG,
        context.ERR_TYPE_SOURCE_TAG,
        context.ERR_TYPE_IMPORT_TAG,
        context.ERR_TYPE_ISO_NODE,
        context.ERR_TYPE_DUPE_NODE,
        context.ERR_TYPE_OVERLAP_WAY
    ]);

    context.ERR_STATUS_OPEN = 1;
    context.ERR_STATUS_FIXED = 2;
    context.ERR_STATUS_REMOVED = 3;

    context.SHORT_WAY_NODES_THD = 7;
    context.SHORT_WAY_LEGNTH_THD = 30;
    context.SHORT_EDGE_LEGNTH_THD = 15;

    context.getErrorList = function() {
        return errorList;
    }

    function refillErrorList() {
        var graph = context.graph();
        errorList = [];
        curErrorIndex = -1;
        for (var id in graph.entities) {
            var ent = graph.entities[id];
            if (!ent) continue;

            var lint_tag = false, note_tag = false;
            for (var key in ent.tags) {
                lint_tag = lint_tag || key.startsWith('lint');
                note_tag = note_tag || key.startsWith('note');
            }
            if (lint_tag) {
                errorList.push({
                    eid: id,
                    error: context.ERR_TYPE_LINT_TAG,
                    status: context.ERR_STATUS_OPEN
                });
            }

            if (isWayForCommonErrorCheck(id)) {
                if (note_tag) {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_NOTE_TAG,
                        status: context.ERR_STATUS_OPEN
                    });
                }
                if (isInvalidWay(ent)) {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_INVALID_WAY,
                        status: context.ERR_STATUS_OPEN
                    });
                }
                if (ent.tags.bridge && !ent.tags.layer) {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_LAYER_TAG,
                        status: context.ERR_STATUS_OPEN
                    });
                }
                if (context.editInBoundsMode() ===
                    context.EDIT_IN_BOUNDS_FROM_OSM_XML &&
                    ent.tags['source'] !== 'digitalglobe') {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_SOURCE_TAG,
                        status: context.ERR_STATUS_OPEN
                    });
                }
                if (context.editInBoundsMode() ===
                    context.EDIT_IN_BOUNDS_FROM_OSM_XML &&
                    ent.tags['import'] !== 'yes') {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_IMPORT_TAG,
                        status: context.ERR_STATUS_OPEN
                    });
                }
                if (ent.nodes.length <= context.SHORT_WAY_NODES_THD &&
                    isWayOpenEnded(ent, graph)) {
                    var len = geoWayLength(id, graph);
                    if (len <= context.SHORT_WAY_LEGNTH_THD) {
                        errorList.push({
                            eid: id,
                            error: context.ERR_TYPE_SHORT_WAY,
                            status: context.ERR_STATUS_OPEN,
                            info: Math.floor(len) + 'm'
                        });
                    }
                }
                if (ent.tags.highway === 'unclassified' &&
                    !connectToMajorOrUnclassified(ent, graph)) {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_UNCLS_CONNECT,
                        status: context.ERR_STATUS_OPEN
                    });
                }
                if (selfIntersecting(ent)) {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_SELF_INTERSECT,
                        status: context.ERR_STATUS_OPEN
                    });
                }
                var crossWid = crossesOtherWay(ent, graph, context.history());
                if (crossWid !== null) {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_CROSS_WAY,
                        status: context.ERR_STATUS_OPEN,
                        info: crossWid
                    });
                }
            }

            if (isWayForOverlapWayCheck(id)) {
                var overlapWid = overlapWithOtherWay(ent, graph);
                if (overlapWid !== null) {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_OVERLAP_WAY,
                        status: context.ERR_STATUS_OPEN,
                        info: overlapWid
                    });
                }
            }

            if (isNodeForErrorCheck(id)) {
                if (note_tag) {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_NOTE_TAG,
                        status: context.ERR_STATUS_OPEN
                    });
                }
                // check for newly created disconnected nodes
                if (!graph._parentWays[id] ||
                    graph._parentWays[id].length < 1) {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_ISO_NODE,
                        status: context.ERR_STATUS_OPEN
                    });
                }
                if (isDupeNode(ent)) {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_DUPE_NODE,
                        status: context.ERR_STATUS_OPEN
                    });
                }
                var len = isNodeWithPossibleYConnection(id);
                if (len !== null) {
                    errorList.push({
                        eid: id,
                        error: context.ERR_TYPE_Y_CONNECTION,
                        status: context.ERR_STATUS_OPEN,
                        info: Math.floor(len) + 'm'
                    });
                }
            }
        }
        if (context.editInBoundsMode() !== context.NOT_EDIT_IN_BOUNDS) {
            sortErrorList();
        }
    }

    function isWayForCommonErrorCheck(eid) {
        if (eid[0] !== 'w') return false;
        if (eid[1] === '-') return true;
        // when not editing XML files, also check ways with import=yes and
        // source=digitalglobe
        if (context.editInBoundsMode() !==
            context.EDIT_IN_BOUNDS_FROM_OSM_XML) {
            var tags = context.entity(eid).tags;
            return tags.import === 'yes' && tags.source === 'digitalglobe';
        }
        return false;
    }

    function isWayForOverlapWayCheck(eid) {
        if (isWayForCommonErrorCheck(eid)) return true;
        if (context.editInBoundsMode() === context.EDIT_IN_BOUNDS_FROM_OSM_XML
            && eid[0] === 'w') {
            return containsNegative(context.entity(eid).nodes);
        }
        return false;
    }

    function isNodeForErrorCheck(eid) {
        if (eid[0] !== 'n') return false;
        if (eid[1] === '-') return true;
        // also check positive nodes on ways
        var wids = context.graph()._parentWays[eid];
        if (!wids) return false;
        for (var i = 0; i < wids.length; i++) {
            var tags = context.entity(wids[i]).tags;
            if (tags.import === 'yes' && tags.source === 'digitalglobe') {
                return true;
            }
        }

        return false;
    }

    // Sort entities in errorList by their locations. First group them by grid
    // in a 16-grid set up, then sort the groups in the following order:
    // 01 02|05 06
    // 03 04|07 08
    // -----|-----
    // 09 10|13 14
    // 11 12|15 16
    function sortErrorList() {
        if (errorList.length < 2) return;

        // figure out which grid each error entity belongs to
        var eidToGridNum = {};
        errorList.forEach(function(errObj) {
            if (errObj.eid in eidToGridNum) return;
            if (errObj.eid[0] === 'n') {
                var loc = context.entity(errObj.eid).loc;
                eidToGridNum[errObj.eid] = gridNumberByLoc(loc[0], loc[1]);
            } else if (errObj.eid[0] === 'w') {
                // assign a way to the grid having biggest number of its nodes
                var gridNumToNodeCount = {},
                    way = context.entity(errObj.eid);

                way.nodes.forEach(function(nid) {
                    var loc = context.entity(nid).loc,
                        gridNum = gridNumberByLoc(loc[0], loc[1]);
                    if (gridNum in gridNumToNodeCount) {
                        gridNumToNodeCount[gridNum] += 1;
                    } else {
                        gridNumToNodeCount[gridNum] = 1;
                    }
                });

                var maxCount = 0,
                    wayGridNum = 0;
                for (var gridNum in gridNumToNodeCount) {
                    if (gridNumToNodeCount[gridNum] > maxCount) {
                        maxCount = gridNumToNodeCount[gridNum];
                        wayGridNum = gridNum;
                    }
                }
                eidToGridNum[errObj.eid] = wayGridNum;
            }
        });

        errorList.sort(function(e1, e2) {
            if (e1.eid === e2.eid) return 0;
            return eidToGridNum[e1.eid] - eidToGridNum[e2.eid];
        });
    }

    // compute the grid number (1 - 16) of a given lat/lon
    // 01 02|05 06
    // 03 04|07 08
    // -----|-----
    // 09 10|13 14
    // 11 12|15 16
    function gridNumberByLoc(lon, lat) {
        // First, divide the whole mapBounds into 4 zones as indicated in
        // the comments of computeZoneNumber() below. The input lat/lon will
        // fall into zone 1, 2, 3, or 4.
        var midlon = (mapBounds.minlon + mapBounds.maxlon) / 2,
            midlat = (mapBounds.minlat + mapBounds.maxlat) / 2,
            zoneNum = computeZoneNumber(midlon, midlat, lon, lat);

        // Then break the zone containing the input lat/lon further into 4
        // subzones. Again the input lat/lon will fall into one of the subzones.
        // Each subzone correspond to one grid in the 4x4 grid layout.
        var zoneMinLat = zoneNum <= 2 ? midlat : mapBounds.minlat,
            zoneMaxLat = zoneNum <= 2 ? mapBounds.maxlat : midlat,
            zoneMinLon = zoneNum % 2 !== 0 ? mapBounds.minlon : midlon,
            zoneMaxLon = zoneNum % 2 !== 0 ? midlon : mapBounds.maxlon,
            zoneMidLon = (zoneMinLon + zoneMaxLon) / 2,
            zoneMidLat = (zoneMinLat + zoneMaxLat) / 2,
            subzoneNum = computeZoneNumber(zoneMidLon, zoneMidLat, lon, lat);

        // The grid number for input lat/lon can be computed based on zoneNum
        // and subzoneNum
        return (zoneNum -  1) * 4 + subzoneNum;
    }

    // Divide a bounding box into 4 zones and return zone number:
    // 1 | 2
    // --|--
    // 3 | 4
    function computeZoneNumber(midlon, midlat, lon, lat) {
        var latZone = lat >= midlat ? 0 : 1,
            lonZone = lon <= midlon ? 0 : 1;

        return latZone * 2 + lonZone + 1
    }

    function isInvalidWay(entity) {
        if (!entity || entity.id[0] !== 'w') return false;
        return !entity.nodes || entity.nodes.length < 2;
    }

    // check if either end of way is open (not connected to any other way)
    function isWayOpenEnded(way, graph) {
        var pwids1 = graph._parentWays[way.nodes[0]],
            pwids2 = graph._parentWays[way.nodes[way.nodes.length - 1]];
        return pwids1.length < 2 || pwids2.length < 2;
    }

    // check if way crosses any other way in graph without a connection node
    function crossesOtherWay(way, graph, history) {
        for (var i = 0; i < way.nodes.length - 1; i++) {
            var nid1 = way.nodes[i],
                nid2 = way.nodes[i + 1],
                n1 = graph.entity(nid1),
                n2 = graph.entity(nid2),
                extent = geoExtent([
                    [
                        Math.min(n1.loc[0], n2.loc[0]),
                        Math.min(n1.loc[1], n2.loc[1])
                    ],
                    [
                        Math.max(n1.loc[0], n2.loc[0]),
                        Math.max(n1.loc[1], n2.loc[1])
                    ]
                ]),
                intersected = history.intersects(extent);
            for (var j = 0; j < intersected.length; j++) {
                var eid = intersected[j].id;
                if (eid[0] !== 'w') continue;

                // only check crossing highway, waterway, building, and railway
                var crossWayTags = intersected[j].tags;
                if (!(crossWayTags.highway || crossWayTags.building ||
                      crossWayTags.railway || crossWayTags.waterway)) {
                    continue;
                }
                if (crossWayTags.waterway && way.tags.bridge === 'yes') {
                    continue;
                }
                if (edgeCrossesWay(n1, n2, intersected[j], graph)) {
                    return intersected[j].id;
                }
            }
        }
        return null;
    }

    // check if the edge going from n1 to n2 crosses (without a connection node)
    // any edge on way
    function edgeCrossesWay(n1, n2, way, graph) {
        for (var j = 0; j < way.nodes.length - 1; j++) {
            var nidA = way.nodes[j],
                nidB = way.nodes[j + 1];
            if (nidA === n1.id || nidA === n2.id ||
                nidB === n1.id || nidB === n2.id) {
                // n1 or n2 is a connection node; skip
                continue;
            }
            var nA = graph.entity(nidA),
                nB = graph.entity(nidB);
            if (geoLineIntersection([n1.loc, n2.loc], [nA.loc, nB.loc])) {
                return true;
            }
        }
        return false;
    }

    function overlapWithOtherWay(way, graph) {
        for (var i = 0; i < way.nodes.length - 1; i++) {
            var nid1 = way.nodes[i],
                nid2 = way.nodes[i + 1],
                pws1 = graph._parentWays[nid1],
                pws2 = graph._parentWays[nid2];
            if (pws1.length < 2 || pws2.length < 2) continue;
            pws1 = new Set(pws1);
            for (var j = 0; j < pws2.length; j++) {
                if (pws2[j] !== way.id && pws1.has(pws2[j]) &&
                    wayContainsEdge(graph.entity(pws2[j]), nid1, nid2)) {
                    return pws2[j];
                }
            }
        }
        return null;
    }

    // check if way contains an edge composed of nid1 and nid2
    function wayContainsEdge(way, nid1, nid2) {
        for (var i = 0; i < way.nodes.length - 1; i++) {
            if ((way.nodes[i] === nid1 && way.nodes[i+1] === nid2) ||
                (way.nodes[i] === nid2 && way.nodes[i+1] === nid1)) {
                return true;
            }
        }
        return false;
    }

    function selfIntersecting(way) {
        var ns = new Set(way.nodes);
        return ns.size < way.nodes.length;
    }

    function connectToMajorOrUnclassified(way, graph) {
        for (var i = 0; i < way.nodes.length; i++) {
            var pwids = graph._parentWays[way.nodes[i]];
            if (pwids.length < 2) continue;
            for (var j = 0; j < pwids.length; j++) {
                if (pwids[j] === way.id) continue;
                var ptype = graph.entity(pwids[j]).tags.highway;
                if (!ptype) continue;
                if (MAJOR_AND_UNCLASSIFIED.has(ptype)) return true;
            }
        }
        return false;
    }

    var MAJOR_AND_UNCLASSIFIED = new Set([
        'motorway',
        'motorway_link',
        'trunk',
        'trunk_link',
        'primary',
        'primary_link',
        'secondary',
        'secondary_link',
        'tertiary',
        'tertiary_link',
        'unclassified'
    ]);

    // check if given ent is a duplicated node of any other node
    function isDupeNode(ent) {
        if (ent.id[0] !== 'n') return false;

        var epsilon = 1e-6,
            extent = geoExtent([
                [ent.loc[0] - 2 * epsilon, ent.loc[1] - 2 * epsilon],
                [ent.loc[0] + 2 * epsilon, ent.loc[1] + 2 * epsilon]
            ]);
        var filteredEnts = context.intersects(extent);
        for (var i = 0; i < filteredEnts.length; i++) {
            var entity = filteredEnts[i];
            if (entity.id[0] === 'n' && entity.id !== ent.id &&
                Math.abs(ent.loc[0] - entity.loc[0]) < epsilon &&
                Math.abs(ent.loc[1] - entity.loc[1]) < epsilon) {
                return true;
            }
        }
        return false;
    }

    // for intersection nodes, we want to check for short edges
    // around, which may indicate 'Y' shaped intersections
    function isNodeWithPossibleYConnection(eid) {
        var pways = context.graph().parentWays(context.entity(eid));
        if (pways.length < 2) return null;
        var shortEdges = [];
        for (var i = 0; i < pways.length; i++) {
            var way = pways[i], tags = way.tags;
            if (tags.import !== 'yes' || tags.source !== 'digitalglobe') {
                continue;
            }
            var j = way.nodes.indexOf(eid);
            if (j < 0) continue;
            if (j > 0) {
                var len = geoSphericalDistance(
                        context.entity(way.nodes[j - 1]).loc,
                        context.entity(eid).loc
                    );
                if (len <= context.SHORT_EDGE_LEGNTH_THD) shortEdges.push(len);
            }
            if (j < way.nodes.length - 1) {
                var len = geoSphericalDistance(
                        context.entity(eid).loc,
                        context.entity(way.nodes[j + 1]).loc
                    );
                if (len <= context.SHORT_EDGE_LEGNTH_THD) shortEdges.push(len);
            }
        }

        // We need >=2 short edges as a strong indicator for 'Y'-shaped
        // connections. The case with only 1 short edge normally means one road
        // at the connection is good and straight; the short edge in the other
        // road corresponds to a small curve or turn leading to the connection;
        // such cases are mostly acceptable.
        return shortEdges.length >= 2 ? Math.min(...shortEdges) : null;
    }

    function getNextErrorIndex(submitBlockingOnly) {
        if (errorList.length === 0) return -1;

        var maxToCheck = curErrorIndex < 0
                ? errorList.length
                : errorList.length - 1,
            count = 0,
            nextErrorIndex = curErrorIndex < 0
                ? 0
                : (curErrorIndex + 1) % errorList.length,
            curErrorEid = curErrorIndex < 0
                ? null
                : errorList[curErrorIndex].eid;
        while (count++ < maxToCheck) {
            var nextErr = errorList[nextErrorIndex];
            if ((!submitBlockingOnly || SUBMIT_BLOCKING_ERR.has(nextErr.error))
                && nextErr.eid !== curErrorEid && isErrorStillOpen(nextErr)) {
                return nextErrorIndex;
            }
            nextErrorIndex = (nextErrorIndex + 1) % errorList.length;
        }
        return -1;
    }

    function isErrorStillOpen(errObj) {
        if (errObj.status !== context.ERR_STATUS_OPEN) return false;

        var graph = context.graph(),
            ent = graph.hasEntity(errObj.eid);
        if (!ent) {
            errObj.status = context.ERR_STATUS_REMOVED;
            return false;
        }

        switch (errObj.error) {
            case context.ERR_TYPE_LINT_TAG:
                for (var key in ent.tags) {
                    if (key.startsWith('lint')) return true;
                }
                break;
            case context.ERR_TYPE_NOTE_TAG:
                for (var key in ent.tags) {
                    if (key.startsWith('note')) return true;
                }
                break;
            case context.ERR_TYPE_SOURCE_TAG:
                if (ent.tags['source'] !== 'digitalglobe') return true;
                break;
            case context.ERR_TYPE_IMPORT_TAG:
                if (ent.tags['import'] !== 'yes') return true;
                break;
            case context.ERR_TYPE_ISO_NODE:
                if (!graph._parentWays[errObj.eid] ||
                    graph._parentWays[errObj.eid].length < 1) {
                    return true;
                }
                break;
            case context.ERR_TYPE_DUPE_NODE:
                if (isDupeNode(ent)) return true;
                break;
            case context.ERR_TYPE_Y_CONNECTION:
                if (isNodeWithPossibleYConnection(errObj.eid)) return true;
                break;
            case context.ERR_TYPE_INVALID_WAY:
                if (isInvalidWay(ent)) return true;
                break;
            case context.ERR_TYPE_SHORT_WAY:
                if (ent.nodes.length <= context.SHORT_WAY_NODES_THD &&
                    isWayOpenEnded(ent, graph) &&
                    geoWayLength(errObj.eid, graph) <=
                    context.SHORT_WAY_LEGNTH_THD) {
                    return true;
                }
                break;
            case context.ERR_TYPE_UNCLS_CONNECT:
                if (ent.tags.highway === 'unclassified' &&
                    !connectToMajorOrUnclassified(ent, graph)) {
                    return true;
                }
                break;
            case context.ERR_TYPE_SELF_INTERSECT:
                if (selfIntersecting(ent)) return true;
                break;
            case context.ERR_TYPE_OVERLAP_WAY:
                if (overlapWithOtherWay(ent, graph) !== null) return true;
                break;
            case context.ERR_TYPE_CROSS_WAY:
                if (crossesOtherWay(ent, graph, context.history()) !== null) {
                    return true;
                }
                break;
            case context.ERR_TYPE_LAYER_TAG:
                if (ent.tags.bridge && !ent.tags.layer) return true;
                break;
        }

        errObj.status = context.ERR_STATUS_FIXED;
        return false;
    }

    context.findNextError = function(submitBlockingOnly) {
        curErrorIndex = getNextErrorIndex(submitBlockingOnly);
        if (curErrorIndex >= 0) return errorList[curErrorIndex];

        refillErrorList();
        curErrorIndex = getNextErrorIndex(submitBlockingOnly);
        return curErrorIndex >= 0 ? errorList[curErrorIndex] : null;
    }

    context.findPreviousError = function() {
        if (errorList.length === 0 || curErrorIndex < 0) return null;

        var count = 0,
            prevErrorIndex = curErrorIndex - 1,
            curErrorEid = errorList[curErrorIndex].eid;
        while (count++ < errorList.length) {
            if (prevErrorIndex < 0) prevErrorIndex = errorList.length - 1;

            var prevErr = errorList[prevErrorIndex];
            if (prevErr.eid !== curErrorEid && isErrorStillOpen(prevErr)) {
                curErrorIndex = prevErrorIndex;
                return prevErr;
            }
            prevErrorIndex--;
        }
        return null;
    }

    context.getErrorMsgForEntity = function(eid) {
        var errorMsg = '',
            submitBlocking = false;
        for (var i = 0; i < errorList.length; i++) {
            if (errorList[i].eid === eid && isErrorStillOpen(errorList[i])) {
                if (errorList[i].error === context.ERR_TYPE_LINT_TAG) {
                    for (key in context.entity(eid).tags) {
                        if (key.startsWith('lint')) {
                            errorMsg += key + ', ';
                        }
                    }
                } else {
                    errorMsg += context.ERR_TYPE_MSG[errorList[i].error];
                    if (errorList[i].info) {
                        errorMsg += ' ' + (errorList[i].info);
                    }
                    errorMsg += ', ';
                }
                submitBlocking = submitBlocking ||
                    SUBMIT_BLOCKING_ERR.has(errorList[i].error);
            }
        }

        // remove ', ' in the end
        if (errorMsg.length > 0) {
            var prefix = submitBlocking
                ? t('validations.error')
                : t('validations.warning');
            errorMsg = prefix + errorMsg.substr(0, errorMsg.length - 2);
        }
        return errorMsg;
    }

    var maxEntHighlightZoom = 18;
    context.maxEntHighlightZoom = function(_) {
        if (!arguments.length) return maxEntHighlightZoom;
        maxEntHighlightZoom = _;
        return context;
    };

    context.genXMLStringFromGraph = function() {
        var entities = context.graph().entities,
            bounds = context.getMapBounds();
        if (!bounds || isObjectEmptyWithProto(entities)) return null;

        var ents = context.focusOnRoads()
            ? entsRelatedToRoads(entities)
            : entities;
        return genXMLStringForEnts(ents, bounds);
    };

    // collect set of entities to inlcude in XML to save
    function experimentalEntsToSaveInXML(entities) {
        var parentWids = context.graph()._parentWays,
            negWays = {},
            posWays = {},
            nodes = {};

        // step 1: include all negative ways and negative nodes
        for (eid in entities) {
            if (eid.startsWith('n-') && !nodes[eid]) {
                nodes[eid] = entities[eid];
            } else if (eid.startsWith('w-')) {
                negWays[eid] = entities[eid];
                entities[eid].nodes.forEach(function (nid) {
                    if (!nodes[nid]) nodes[nid] = entities[nid];
                });
            }
        }

        // step 2: include positive ways having connections to negative ways,
        // as well as positive nodes they contain
        for (nid in nodes) {
            var wids = parentWids[nid];
            if (!wids) continue;
            wids.forEach(function(wid) {
                if (wid[1] !== '-' && !posWays[wid]) {
                    posWays[wid] = entities[wid];
                    entities[wid].nodes.forEach(function (nid) {
                        if (nid[1] !== '-' && !nodes[nid]) {
                            nodes[nid] = entities[nid];
                        }
                    });
                }
            });
        }

        // step 3: include postive ways with action=modify or edited=true,
        // as well as positvie nodes they contain
        for (eid in entities) {
            if (eid[1] === '-' || eid[0] !== 'w') continue;
            var way = entities[eid];
            if ((way.action === 'modify' || way.tags.edited) && !posWays[eid]) {
                posWays[eid] = way;
                way.nodes.forEach(function (nid) {
                    if (nid[1] !== '-' && !nodes[nid]) {
                        nodes[nid] = entities[nid];
                    }
                });
            }
        }

        return _.merge(negWays, posWays, nodes);
    }

    function genXMLStringForEnts(ents, bounds) {
        var xmlDoc = document.implementation.createDocument(null, 'osm'),
            osmEle = xmlDoc.documentElement;
        osmEle.setAttribute('attribution',
            'http://www.openstreetmap.org/copyright');
        osmEle.setAttribute('copyright', 'OpenStreetMap and contributors');
        osmEle.setAttribute('generator', 'iD');
        osmEle.setAttribute('license',
            'http://opendatacommons.org/licenses/odbl/1-0/');
        osmEle.setAttribute('version', '0.6');

        var boundsEle = xmlDoc.createElement("bounds");
        boundsEle.setAttribute('maxlat', bounds.maxlat);
        boundsEle.setAttribute('maxlon', bounds.maxlon);
        boundsEle.setAttribute('minlat', bounds.minlat);
        boundsEle.setAttribute('minlon', bounds.minlon);
        osmEle.appendChild(boundsEle);

        for (eid in ents) {
            if (isNaN(eid.substring(1))) continue;
            osmEle.appendChild(eid[0] === 'r'
                ? relationXMLElement(xmlDoc, ents[eid])
                : (eid[0] === 'w'
                    ? wayXMLElement(xmlDoc, ents[eid])
                    : nodeXMLElement(xmlDoc, ents[eid]))
            );
        }

        return (new XMLSerializer()).serializeToString(xmlDoc);
    }

    function relationXMLElement(xmlDoc, rel) {
        var relEle = xmlDoc.createElement('relation');
        relEle.setAttribute('id', rel.id.substring(1));
        relEle.setAttribute('visible', rel.visible);
        if (rel.action) relEle.setAttribute('action', rel.action);
        if (rel.version) relEle.setAttribute('version', rel.version);
        if (rel.changeset) relEle.setAttribute('changeset', rel.changeset);
        if (rel.timestamp) relEle.setAttribute('timestamp', rel.timestamp);
        if (rel.user) relEle.setAttribute('user', rel.user);
        if (rel.uid) relEle.setAttribute('uid', rel.uid);

        rel.members.forEach(function(mem) {
            var memEle = xmlDoc.createElement('member');
            memEle.setAttribute(
                'type',
                mem.id[0] === 'r'
                    ? 'relation'
                    : (mem.id[0] === 'w' ? 'way' : 'node')
            );
            memEle.setAttribute('ref', mem.id.substring(1));
            memEle.setAttribute('role', mem.role);
            relEle.appendChild(memEle);
        });

        for (k in rel.tags) {
            var tagEle = xmlDoc.createElement('tag');
            tagEle.setAttribute('k', k);
            tagEle.setAttribute('v', rel.tags[k]);
            relEle.appendChild(tagEle);
        }
        return relEle;
    }

    function wayXMLElement(xmlDoc, way) {
        var wayEle = xmlDoc.createElement('way');
        wayEle.setAttribute('id', way.id.substring(1));
        wayEle.setAttribute('visible', way.visible);
        if (way.action) wayEle.setAttribute('action', way.action);
        if (way.version) wayEle.setAttribute('version', way.version);
        if (way.changeset) wayEle.setAttribute('changeset', way.changeset);
        if (way.timestamp) wayEle.setAttribute('timestamp', way.timestamp);
        if (way.user) wayEle.setAttribute('user', way.user);
        if (way.uid) wayEle.setAttribute('uid', way.uid);

        way.nodes.forEach(function(nid) {
            var ndEle = xmlDoc.createElement('nd');
            ndEle.setAttribute('ref', nid.substring(1));
            wayEle.appendChild(ndEle);
        });

        for (k in way.tags) {
            var tagEle = xmlDoc.createElement('tag');
            tagEle.setAttribute('k', k);
            tagEle.setAttribute('v', way.tags[k]);
            wayEle.appendChild(tagEle);
        }
        return wayEle;
    }

    function nodeXMLElement(xmlDoc, node) {
        var nodeEle = xmlDoc.createElement('node');
        nodeEle.setAttribute('id', node.id.substring(1));
        nodeEle.setAttribute('lon', node.loc[0]);
        nodeEle.setAttribute('lat', node.loc[1]);
        nodeEle.setAttribute('visible', node.visible);

        if (node.action) nodeEle.setAttribute('action', node.action);
        if (node.version) nodeEle.setAttribute('version', node.version);
        if (node.changeset) nodeEle.setAttribute('changeset', node.changeset);
        if (node.timestamp) nodeEle.setAttribute('timestamp', node.timestamp);
        if (node.user) nodeEle.setAttribute('user', node.user);
        if (node.uid) nodeEle.setAttribute('uid', node.uid);

        for (k in node.tags) {
            var tagEle = xmlDoc.createElement('tag');
            tagEle.setAttribute('k', k);
            tagEle.setAttribute('v', node.tags[k]);
            nodeEle.appendChild(tagEle);
        }
        return nodeEle;
    }

    // This tells history if it's OK to add automatic tags (e.g. edited=true)
    // upon changes
    var allowAutoTagging = false;
    context.allowAutoTagging = function(_) {
        if (!arguments.length) return allowAutoTagging;
        allowAutoTagging = _;
        return context;
    };

    context.isReadOnlyMode = function() {
        return context.initialURLParams.read_only === 'true';
    }

    /* History */
    var inIntro = false;
    context.inIntro = function(_) {
        if (!arguments.length) return inIntro;
        inIntro = _;
        return context;
    };

    context.save = function() {
        // no history save, no message onbeforeunload
        if (inIntro || d3.select('.modal').size()) return;

        var canSave;
        if (mode && mode.id === 'save') {
            canSave = false;
        } else {
            canSave = context.selectedIDs().every(function(id) {
                var entity = context.hasEntity(id);
                return entity && !entity.isDegenerate();
            });
        }

        if (canSave) {
            history.save();
        }
        if (history.hasChanges()) {
            return t('save.unsaved_changes');
        }
    };


    /* Graph */
    context.hasEntity = function(id) {
        return history.graph().hasEntity(id);
    };
    context.entity = function(id) {
        return history.graph().entity(id);
    };
    context.childNodes = function(way) {
        return history.graph().childNodes(way);
    };
    context.geometry = function(id) {
        return context.entity(id).geometry(history.graph());
    };


    /* Modes */
    var mode;
    context.mode = function() {
        return mode;
    };
    context.enter = function(newMode) {
        if (mode) {
            mode.exit();
            dispatch.call('exit', this, mode);
        }

        mode = newMode;
        mode.enter();
        dispatch.call('enter', this, mode);
    };

    context.selectedIDs = function() {
        if (mode && mode.selectedIDs) {
            return mode.selectedIDs();
        } else {
            return [];
        }
    };


    /* Behaviors */
    context.install = function(behavior) {
        context.surface().call(behavior);
    };
    context.uninstall = function(behavior) {
        context.surface().call(behavior.off);
    };


    /* Copy/Paste */
    var copyIDs = [], copyGraph;
    context.copyGraph = function() { return copyGraph; };
    context.copyIDs = function(_) {
        if (!arguments.length) return copyIDs;
        copyIDs = _;
        copyGraph = history.graph();
        return context;
    };


    /* Background */
    var background;
    context.background = function() { return background; };


    /* Features */
    var features;
    context.features = function() { return features; };
    context.hasHiddenConnections = function(id) {
        var graph = history.graph(),
            entity = graph.entity(id);
        return features.hasHiddenConnections(entity, graph);
    };


    /* Presets */
    var presets;
    context.presets = function() { return presets; };


    /* Map */
    var map;
    context.map = function() { return map; };
    context.layers = function() { return map.layers; };
    context.surface = function() { return map.surface; };
    context.editable = function() { return map.editable(); };
    context.surfaceRect = function() {
        return map.surface.node().getBoundingClientRect();
    };


    /* Debug */
    var debugFlags = {
        tile: false,
        collision: false,
        imagery: false,
        imperial: false,
        driveLeft: false
    };
    context.debugFlags = function() {
        return debugFlags;
    };
    context.setDebug = function(flag, val) {
        if (arguments.length === 1) val = true;
        debugFlags[flag] = val;
        dispatch.call('change');
        return context;
    };
    context.getDebug = function(flag) {
        return flag && debugFlags[flag];
    };


    /* Container */
    var container = d3.select(document.body);
    context.container = function(_) {
        if (!arguments.length) return container;
        container = _;
        container.classed('id-container', true);
        return context;
    };
    var embed;
    context.embed = function(_) {
        if (!arguments.length) return embed;
        embed = _;
        return context;
    };


    /* Assets */
    var assetPath = '';
    context.assetPath = function(_) {
        if (!arguments.length) return assetPath;
        assetPath = _;
        return context;
    };

    var assetMap = {};
    context.assetMap = function(_) {
        if (!arguments.length) return assetMap;
        assetMap = _;
        return context;
    };

    context.asset = function(_) {
        var filename = assetPath + _;
        return assetMap[filename] || filename;
    };

    context.imagePath = function(_) {
        return context.asset('img/' + _);
    };


    /* locales */
    // `locale` variable contains a "requested locale".
    // It won't become the `currentLocale` until after loadLocale() is called.
    var locale, localePath;

    context.locale = function(loc, path) {
        if (!arguments.length) return currentLocale;
        locale = loc;
        localePath = path;
        return context;
    };

    context.loadLocale = function(callback) {
        if (locale && locale !== 'en' && dataLocales.hasOwnProperty(locale)) {
            localePath = localePath ||
                context.asset('locales/' + locale + '.json');
            d3.json(localePath, function(err, result) {
                if (!err) {
                    addTranslation(locale, result[locale]);
                    setLocale(locale);
                    utilDetect(true);
                }
                if (callback) {
                    callback(err);
                }
            });
        } else {
            if (locale) {
                setLocale(locale);
                utilDetect(true);
            }
            if (callback) {
                callback();
            }
        }
    };


    /* reset (aka flush) */
    context.reset = context.flush = function() {
        context.debouncedSave.cancel();
        _.each(services, function(service) {
            if (service && typeof service.reset === 'function') {
                service.reset(context);
            }
        });
        features.reset();
        history.reset();
        return context;
    };


    /* Init */

    context.initialURLParams = utilStringQs(window.location.hash.substring(1));
    context.projection = geoRawMercator();
    context.curtainProjection = geoRawMercator();

    locale = utilDetect().locale;
    if (locale && !dataLocales.hasOwnProperty(locale)) {
        locale = locale.split('-')[0];
    }

    history = coreHistory(context);
    context.graph = history.graph;
    context.changes = history.changes;
    context.intersects = history.intersects;

    // Debounce save, since it's a synchronous localStorage write,
    // and history changes can happen frequently (e.g. when dragging).
    context.debouncedSave = _.debounce(context.save, 350);
    function withDebouncedSave(fn) {
        return function() {
            var result = fn.apply(history, arguments);
            context.debouncedSave();
            return result;
        };
    }

    context.perform = withDebouncedSave(history.perform);
    context.replace = withDebouncedSave(history.replace);
    context.pop = withDebouncedSave(history.pop);
    context.overwrite = withDebouncedSave(history.overwrite);
    context.undo = withDebouncedSave(history.undo);
    context.redo = withDebouncedSave(history.redo);

    ui = uiInit(context);

    connection = services.osm;
    var OSM_SERVERS = {
        official: {
            url: 'https://www.openstreetmap.org',
            oauth_consumer_key: '5A043yRSEugj4DJ5TljuapfnrflWDte8jTOcWLlT',
            oauth_secret: 'aB3jKq1TRsCOUrfOIZ6oQMEDmv2ptV76PA54NGLL',
            chunk_size: 150,
        },
        osm_dev: {
            url: 'https://master.apis.dev.openstreetmap.org',
            oauth_consumer_key: 'dujbeFSGKfqk9HyXAtRrXg3YmYUjAa7DCKrYEdRw',
            oauth_secret: 'nkKPRCF4UvikF77LfHopL6bp0s6KnSOGEkT40EKh',
            chunk_size: 150,
        }
    };
    if (context.initialURLParams.hasOwnProperty('osm_server_id') &&
        OSM_SERVERS[context.initialURLParams.osm_server_id]) {
        connection.initServerMetadata(
            OSM_SERVERS[context.initialURLParams.osm_server_id]);
    }
    background = rendererBackground(context);
    features = rendererFeatures(context);
    presets = presetIndex();

    map = rendererMap(context);
    context.mouse = map.mouse;
    context.extent = map.extent;
    context.pan = map.pan;
    context.zoomIn = map.zoomIn;
    context.zoomOut = map.zoomOut;
    context.zoomInFurther = map.zoomInFurther;
    context.zoomOutFurther = map.zoomOutFurther;
    context.redrawEnable = map.redrawEnable;

    _.each(services, function(service) {
        if (service && typeof service.init === 'function') {
            service.init(context);
        }
    });

    background.init();
    presets.init();
    areaKeys = presets.areaKeys();


    return utilRebind(context, dispatch, 'on');
}
