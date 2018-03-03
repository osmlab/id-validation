import _ from 'lodash';
import {
    geoExtent,
    geoSphericalDistance
} from '../geo';
import {
    actionChangeTagsBatch,
    actionAddVertex,
    actionDeleteNode
} from '../actions';


/**
 * This action solves a specific use case, to match up ways when
 * merging local changes into submitted OSM data. This action is
 * called after 1) the OSM data is loaded, as a slightly larger area
 * than the local XML data, and 2) the XML data has been merged on
 * top.
 *
 * This action will automatically connect ways with likely candidates
 * near the boundaries of a map, which is useful to merge local
 * changes with existing data. When a way is connected in this manner
 * it is tagged with "lint_autoconnect=true".
 */


function findBorderingNodes(context) {
    var thresh = 0.0006,
        bounds = context.getMapBounds(),
        graph = context.graph();

    function nearBorder(loc) {
        var lon = loc[0], lat = loc[1];
        return (lon <= bounds.minlon + thresh ||
                lon >= bounds.maxlon - thresh ||
                lat <= bounds.minlat + thresh ||
                lat >= bounds.maxlat - thresh);
    }

    function isWayEnd(node) {
        var parentWays = graph._parentWays[node.id],
            parentWay = (parentWays && parentWays.length === 1 &&
                         graph.entities[parentWays[0]]);
        return !!parentWay && (
            parentWay.nodes[0] == node.id ||
            parentWay.nodes[parentWay.nodes.length - 1] == node.id);
    }

    return _.filter(graph.entities, function(entity) {
        return (entity && entity.id.startsWith("n-") &&
                nearBorder(entity.loc) && isWayEnd(entity));
    });
}


function findAngle(a, b, c) {
    var ab = Math.sqrt(Math.pow(b[0] - a[0], 2) + Math.pow(b[1] - a[1], 2)),
        bc = Math.sqrt(Math.pow(b[0] - c[0], 2) + Math.pow(b[1] - c[1], 2)),
        ac = Math.sqrt(Math.pow(c[0] - a[0], 2) + Math.pow(c[1] - a[1], 2));
    return Math.acos((bc * bc + ab * ab - ac * ac) / (2 * bc * ab));
}


function getEdgesFromNode(node, graph) {
    // Given a node id, find all the edges incident at that node.
    var parentWays = graph._parentWays[node.id],
        edges = [];
    _.each(parentWays, function(parentWayId) {
        var parentWay = graph.entities[parentWayId],
            idx = parentWay.nodes.indexOf(node.id),
            currNode = graph.entities[parentWay.nodes[idx]],
            // nextNode, prevNode will be undefined when idx +/- 1
            // is out-of-bounds.
            nextNode = graph.entities[parentWay.nodes[idx + 1]],
            prevNode = graph.entities[parentWay.nodes[idx - 1]];
        nextNode && edges.push([[currNode.loc[0], currNode.loc[1]],
                                [nextNode.loc[0], nextNode.loc[1]]]);
        prevNode && edges.push([[currNode.loc[0], currNode.loc[1]],
                                [prevNode.loc[0], prevNode.loc[1]]]);
    });
    return edges;
}


function makeReplacements(context, bordering) {
    var thresh = 20,
        buffer = 0.0004,
        mergeThresh = Math.PI / 15,
        graph = context.graph();  // may be modified and returned
    _.each(bordering, function(node) {
        // Fetch neighboring nodes within a bbox and consider the
        // node which is closest.
        var parentWays = graph._parentWays[node.id],
            parentWay = graph.entities[parentWays[0]],
            nextNodeInWay = parentWay.nodes[0] === node.id
                ? graph.entities[parentWay.nodes[1]]
                : graph.entities[parentWay.nodes[parentWay.nodes.length - 2]],
            extent = geoExtent([[node.loc[0] - buffer, node.loc[1] - buffer],
                                [node.loc[0] + buffer, node.loc[1] + buffer]]),
            // Use an R-Tree to find entities within a bbox from node.
            filtered = context.intersects(extent),
            minDist = 9999,
            exactMatch = false,
            nextNode,
            closest,
            angle;
        for (var i = 0; i < filtered.length; i++) {
            var entity = filtered[i];
            // Consider only pre-existing nodes.
            if (entity.id[0] === "n" && entity.id[1] !== "-") {
                var entParents = graph._parentWays[entity.id];
                if (!entParents) continue;
                // Skip autoconnect for a node when no parent way is a
                // highway, assuming we don't connect to non-highways.
                var isHighway = _.some(entParents, function(p) {
                    var tags = graph.entities[p].tags;
                    return tags && tags.highway !== undefined;
                });
                if (!isHighway) {
                    continue;
                }
                if (node.loc[0] === entity.loc[0] &&
                    node.loc[1] === entity.loc[1])
                {
                    minDist = 0;
                    closest = entity;
                    exactMatch = true;
                    break;
                }
                var dist = geoSphericalDistance(node.loc, entity.loc);
                if (dist <= thresh && dist < minDist && nextNodeInWay) {
                    angle = findAngle(nextNodeInWay.loc, node.loc, entity.loc);
                    if (angle > 3 * Math.PI / 4) {
                        minDist = dist;
                        closest = entity;
                    }
                }
            }
        }
        if (closest) {
            // Find angle between incident edges in the closest node and
            // edge incident on node. If min angle is less than threshold
            // just add lint_autoconnect tag and continue.
            var edges = getEdgesFromNode(closest, graph),
                minAngle = 9999;
            for (var p = 0; p < edges.length; p++) {
                var edge =  edges[p],
                    other = ((edge[0][0] == closest.loc[0] &&
                              edge[0][1] == closest.loc[1])
                             ? edge[1] : edge[0]);
                if (exactMatch) {
                    angle = findAngle(nextNodeInWay.loc, node.loc, other);
                } else {
                    angle = findAngle(node.loc, closest.loc, other);
                }
                if (angle < minAngle) {
                    minAngle = angle;
                }
            }
            var minDistThresh1 = 1,
                minDistThresh2 = 10; // need minDistThresh2 > minDistThresh1
            if (parentWay && minDist <= minDistThresh2) {
                if (minAngle > mergeThresh) {
                    var newIndex = (parentWay.nodes[0] == node.id
                                    ? 0 : parentWay.nodes.length);
                    graph = actionAddVertex(
                        parentWay.id, closest.id, newIndex)(graph);
                    if (minDist <= minDistThresh1) {
                        graph = actionDeleteNode(node.id)(graph);
                    }
                }
                graph = actionChangeTagsBatch(
                    [parentWay.id], {"lint_autoconnect": "true"})(graph);
            }
        }
    });
    return graph;
}


export function actionAutoConnect(context) {
    return function(graph) {
        if (context.graph() !== graph) {
            // We don't really want to require context as an argument,
            // but we need context.intersects(), and we want it to
            // operate on the same graph we see here.
            throw Error("Must operate on graph matching context argument");
        }
        var bordering = findBorderingNodes(context);
        return makeReplacements(context, bordering);
    };
}
