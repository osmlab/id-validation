import _ from 'lodash';
import { actionDeleteNode } from './delete_node';


// Connect the ways at the given nodes.
//
// The last node will survive. All other nodes will be replaced with
// the surviving node in parent ways, and then removed.
//
// Tags and relation memberships of of non-surviving nodes are merged
// to the survivor.
//
// This is the inverse of `iD.actionDisconnect`.
//
// Reference:
//   https://github.com/openstreetmap/potlatch2/blob/master/net/systemeD/halcyon/connection/actions/MergeNodesAction.as
//   https://github.com/openstreetmap/josm/blob/mirror/src/org/openstreetmap/josm/actions/MergeNodesAction.java
//
export function actionConnect(nodeIds) {
    return function(graph) {
        if (nodeIds.length < 1) return;

        // prefer surviving a positive nodeId
        var lastNid = nodeIds[nodeIds.length - 1];
        if (lastNid[1] === '-') {
            for (var i = 0; i < nodeIds.length - 1; i++) {
                if (nodeIds[i][1] !== '-') {
                    nodeIds[nodeIds.length - 1] = nodeIds[i];
                    nodeIds[i] = lastNid;
                    break;
                }
            }
        }

        var survivor = graph.entity(_.last(nodeIds)),
            hasConnectedRoad = false,
            hasDisconnectedRoad = false,
            connectedWid = null;

        nodeIds.forEach(function(nid) {
            var pwids = graph._parentWays[nid];
            if (!pwids || pwids.length < 1) return;
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
        });

        for (var i = 0; i < nodeIds.length - 1; i++) {
            var node = graph.entity(nodeIds[i]);

            /* eslint-disable no-loop-func */
            graph.parentWays(node).forEach(function(parent) {
                if (!parent.areAdjacent(node.id, survivor.id)) {
                    graph = graph.replace(
                        parent.replaceNode(node.id, survivor.id));
                }
            });

            graph.parentRelations(node).forEach(function(parent) {
                graph = graph.replace(parent.replaceMember(node, survivor));
            });
            /* eslint-enable no-loop-func */

            survivor = survivor.mergeTags(node.tags);
            graph = actionDeleteNode(node.id)(graph);
        }

        if (survivor.tags.lint_hanging) {
            var newTags = _.assign({}, survivor.tags);
            delete newTags.lint_hanging;
            survivor = survivor.update({tags: newTags});
        }
        graph = graph.replace(survivor);

        if (hasDisconnectedRoad && hasConnectedRoad) {
            graph = graph.removeReachableDisconnectedTag(connectedWid);
        }

        return graph;
    };
}
