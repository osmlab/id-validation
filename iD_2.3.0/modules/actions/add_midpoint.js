import _ from 'lodash';
import { geoEdgeEqual } from '../geo/index';


export function actionAddMidpoint(midpoint, node) {
    return function(graph) {
        graph = graph.replace(node.move(midpoint.loc));

        var parents = _.intersection(
            graph.parentWays(graph.entity(midpoint.edge[0])),
            graph.parentWays(graph.entity(midpoint.edge[1])));

        parents.forEach(function(way) {
            for (var i = 0; i < way.nodes.length - 1; i++) {
                if (geoEdgeEqual([way.nodes[i], way.nodes[i + 1]],
                    midpoint.edge)) {
                    graph = graph.replace(graph.entity(way.id).addNode(
                        node.id, i + 1));

                    // Add only one midpoint on doubled-back segments,
                    // turning them into self-intersections.
                    return;
                }
            }
        });

        // In case a midpoint is created by connecting one road to another,
        // check if any lint_disconnected can be removed
        var pwids = graph._parentWays[node.id];
        if (pwids && pwids.length > 1) {
            var hasConnectedRoad = false,
                hasDisconnectedRoad = false,
                connectedWid = null;
            pwids.forEach(function(pwid) {
                var parent = graph.entity(pwid);
                if (parent.tags.highway) {
                    if (parent.tags.lint_disconnected) {
                        hasDisconnectedRoad = true;
                    } else {
                        hasConnectedRoad = true;
                        connectedWid = parent.id;
                    }
                }
            });
            if (hasDisconnectedRoad && hasConnectedRoad) {
                graph = graph.removeReachableDisconnectedTag(connectedWid);
            }
        }

        if (node.tags.lint_hanging) {
            graph = graph.removeTagsOnMultiEnts([node.id], ['lint_hanging']);
        }

        return graph;
    };
}
