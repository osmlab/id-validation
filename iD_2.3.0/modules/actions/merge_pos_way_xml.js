import _ from 'lodash';
import { actionDeleteNode } from './delete_node';
import { posNodeManuallyChanged } from './merge_pos_node_xml';
import { geoSphericalDistance } from '../geo/geo';

export function actionMergePosWayFromXML(wid, entsInXML, entsInBaseXML) {
    return function(graph) {
        // Check if positive nodes in wayInGraph has changed significantly in
        // comparison to nodes in wayFromXML. Significant changes may have been
        // done by other OSM mappers, e.g. by adding many nodes, merging it with
        // other ways, or splitting it into multiple ways.
        function nodesChangedSignificantly(wayFromXML, wayInGraph) {
            var wayNdsInXML = new Set(wayFromXML.nodes),
                wayNdsInGraph = new Set(wayInGraph.nodes),
                ratioThd = wayNdsInXML.length <= 2 ? 0.5 : 0.25,
                countThd = 10,
                nodesLost = new Set(),
                nodesAdded = new Set();

            wayNdsInXML.forEach(function(n) {
              if (n[1] !== '-' && !wayNdsInGraph.has(n)) nodesLost.add(n);
            });
            wayNdsInGraph.forEach(function(n) {
                if (!wayNdsInXML.has(n)) nodesAdded.add(n);
            });
            if (nodesLost.size >= countThd || nodesAdded.size >= countThd ||
                nodesLost.size * 1.0 / wayNdsInXML.size >= ratioThd ||
                nodesAdded.size * 1.0 / wayNdsInXML.size >= ratioThd)
            {
                return true;
            }

            // check if >= 3 consecutive nodes have been lost/added
            var thd = 3;
            if (nodesLost.size < thd && nodesAdded.size < thd) return false;
            return lostEnoughContiguous(wayFromXML.nodes, wayNdsInGraph, thd) ||
                lostEnoughContiguous(wayInGraph.nodes, wayNdsInXML, thd);
        }

        function lostEnoughContiguous(initNodesList, finalNodesSet, thd) {
            var contiguousLost = 0,
                lastLostIdx = -10;
            for (var i = 0; i < initNodesList.length; i++) {
                var nid = initNodesList[i];
                if (finalNodesSet.has(nid)) {
                    contiguousLost = 0;
                    continue;
                }
                if (lastLostIdx === i - 1) {
                    contiguousLost++;
                    if (contiguousLost >= thd) return true;
                } else {
                    contiguousLost = 1;
                }
                lastLostIdx = i;
            }
            return false;
        }

        // see usage below for what this does
        function tagHangingNegNids(graph, wayFromXML) {
            var negNids = _.filter(wayFromXML.nodes, function(nid) {
                return nid[1] === '-';
            });
            return negNids.length > 0
                ? graph.updateTagsOnMultiEnts(negNids, 'lint_hanging', 'true')
                : graph;
        }

        var wayFromXML = entsInXML[wid],
            wayInGraph = graph.hasEntity(wid);
        if (!wayInGraph || !wayInGraph.visible) {
            // wayFromXML is not there anymore in live OSM, so we choose not to
            // merge, but add a lint tag to negative nodes in wayFromXML.
            // They used to be connection nodes between a negative
            // way and wayFromXML, but now need to be manually re-connected.
            return tagHangingNegNids(graph, wayFromXML);
        } else if (_.isEqual(wayFromXML.nodes, wayInGraph.nodes) &&
            _.isEqual(wayFromXML.tags, wayInGraph.tags)) {
            // noop if wayFromXML and wayInGraph have the same nodes and tags
            return graph;
        } else {
            // In case of significant changes on nodes, merging geometry has
            // higher chance of generating bad road geometries. So don't touch
            // the geometry here; just tag the hanging nodes.
            var mergedTags = _.isEqual(wayInGraph.tags, wayFromXML.tags)
                    ? null
                    : entTagsMerge(wayInGraph, wayFromXML,
                          entsInBaseXML ? entsInBaseXML[wid] : null);
            if (nodesChangedSignificantly(wayFromXML, wayInGraph)) {
                graph = tagHangingNegNids(graph, wayFromXML);
                return mergedTags === null
                    ? graph
                    : graph.replace(
                          wayInGraph.update({tags: mergedTags})
                      );
            } else {
                var nidsToRemove = wayInGraph.nodes.filter(function(nid) {
                        return entsInBaseXML && entsInBaseXML[nid] &&
                            !entsInXML[nid];
                    }),
                    mergedNids = wayNodesMerge(wayInGraph.nodes,
                        wayFromXML.nodes, graph.entities, entsInXML,
                        entsInBaseXML
                    );

                if (mergedNids === null) {
                    graph = tagHangingNegNids(graph, wayFromXML);
                    if (mergedTags !== null) {
                      graph = graph.replace(
                          wayInGraph.update({tags: mergedTags}));
                    }
                } else {
                    var updates = mergedTags === null
                        ? {nodes: mergedNids}
                        : {nodes: mergedNids, tags: mergedTags}
                    graph = graph.replace(wayInGraph.update(updates));
                }
                nidsToRemove.forEach(function(nid) {
                    var node = graph.hasEntity(nid);
                    if (node) graph = actionDeleteNode(nid)(graph);
                });
                return graph;
            }
        }
    };
}


// Due to OSM community mappers' activities on making roads one-way and
// reversing their directions, we need to try merging wayNdsInGraph and
// wayNdsInXML in both directions and return the shorter one as final result.
export function wayNodesMerge(
    wayNdsInGraph, wayNdsInXML, entsInGraph, entsInXML, entsInBaseXML) {
    merged1 = wayNodesMergeImpl(wayNdsInGraph, wayNdsInXML, entsInGraph,
        entsInXML, entsInBaseXML);
    merged2 = wayNodesMergeImpl(wayNdsInGraph, wayNdsInXML.slice().reverse(),
        entsInGraph, entsInXML, entsInBaseXML);
    if (merged1 && merged2) {
        return merged1.length <= merged2.length ? merged1 : merged2;
    }
    return merged1 || merged2;
}


// merge the nodes of two ways according to geometric relations, i.e. in
// increasing order of distance from basde node
function wayNodesMergeImpl(
    wayNdsInGraph, wayNdsInXML, entsInGraph, entsInXML, entsInBaseXML) {
    // Step 0. Remove node IDs deleted in entsInXML from wayNdsInGraph
    if (entsInBaseXML !== null) {
        wayNdsInGraph = wayNdsInGraph.filter(function (nid) {
            return !(entsInBaseXML[nid] && !entsInXML[nid]);
        });
    }

    // Step 1-1. record node ID positions in wayNdsInGraph
    var nidPosesB = {};  // "B" means "Base"
    wayNdsInGraph.forEach(function(nid, pos) {
      if (!nidPosesB[nid]) nidPosesB[nid] = [];
      nidPosesB[nid].push(pos);
    });

    // Step 1-2. remove pos node IDs in wayNdsInXML that have been removed by
    // others from entsInGraph
    wayNdsInXML = wayNdsInXML.filter(function (nid) {
        return nid[1] === '-' || (entsInGraph[nid] && entsInGraph[nid].visible);
    });

    // Step 1-3. find positions of matching node IDs in both node arrays
    var matchingNidPoses = [], lastPosInB = -1;
    wayNdsInXML.forEach(function(nid, posInH) {  // "H" means "Head"
      if (!nidPosesB[nid] || nidPosesB[nid].length < 1) return;
      posInB = nidPosesB[nid].shift();
      if (posInB > lastPosInB) {
        matchingNidPoses.push([posInB, posInH]);
        lastPosInB = posInB;
      }
    });

    // in case of no matching node IDs, don't merge
    if (matchingNidPoses.length < 1) return null;

    // Step 2. fill in the section before first pair of matching node IDs
    function mergeSection(startPosInB, startPosInH, startNode, endPosInB,
        endPosInH, isForward) {
        var i = startPosInB,
            j = startPosInH,
            hasMoreWork = isForward
                ? (i < endPosInB && j < endPosInH)
                : (i > endPosInB && j > endPosInH),
            tmpNode = startNode;

        while (hasMoreWork) {
          var baseNode = entsInGraph[wayNdsInGraph[i]],
              headNode = entsInXML[wayNdsInXML[j]],
              dis1 = geoSphericalDistance(tmpNode.loc, baseNode.loc),
              dis2 = geoSphericalDistance(tmpNode.loc, headNode.loc);
          if (dis1 < dis2) {
              if (isForward) {
                  merged.push(wayNdsInGraph[i]);
                  i++;
              } else {
                  merged.unshift(wayNdsInGraph[i]);
                  i--;
              }
              tmpNode = baseNode;
          } else {
              if (isForward) {
                  merged.push(wayNdsInXML[j]);
                  j++;
              } else {
                  merged.unshift(wayNdsInXML[j]);
                  j--;
              }
              tmpNode = headNode;
          }
          hasMoreWork = isForward
              ? (i < endPosInB && j < endPosInH)
              : (i > endPosInB && j > endPosInH);
        }
        if (isForward) {
            while (i < endPosInB) merged.push(wayNdsInGraph[i++]);
            while (j < endPosInH) merged.push(wayNdsInXML[j++]);
        } else {
            while (i > endPosInB) merged.unshift(wayNdsInGraph[i--]);
            while (j > endPosInH) merged.unshift(wayNdsInXML[j--]);
        }
    }

    var posPair = matchingNidPoses.shift(),
        posInB = posPair[0],
        posInH = posPair[1],
        lastNid = wayNdsInXML[posInH],
        merged = [lastNid],
        lastNode = posNodeManuallyChanged(entsInXML, lastNid)
            ? entsInXML[lastNid]
            : entsInGraph[lastNid];

    mergeSection(posInB - 1, posInH - 1, lastNode, -1, -1, false);

    // Step 3. fill in all the gaps between each pair of matching node IDs
    while (matchingNidPoses.length > 0) {
      var nextPosPair = matchingNidPoses.shift();
      var nextPosInB = nextPosPair[0], nextPosInH = nextPosPair[1];
      mergeSection(posInB + 1, posInH + 1, lastNode, nextPosInB, nextPosInH,
          true);
      lastNid = wayNdsInXML[nextPosInH];
      merged.push(lastNid);
      lastNode = posNodeManuallyChanged(entsInXML, lastNid)
          ? entsInXML[lastNid]
          : entsInGraph[lastNid];
      posInB = nextPosInB;
      posInH = nextPosInH;
    }

    // Step 4. fill in section after last pair of matching Node ID
    mergeSection(posInB + 1, posInH + 1, lastNode, wayNdsInGraph.length,
        wayNdsInXML.length, true);;

    return merged;
}


export function entTagsMerge(entInGraph, entInXML, entInBaseXML) {
    var baseTags = entInGraph.tags,
        headTags = entInXML.tags,
        mergedTags = {},
        machineResTags = entInBaseXML ? entInBaseXML.tags : {};

    for (var k in baseTags) {
        if (!headTags[k]) {
            // tag k not in machine result means it's added by other mappers
            if (!machineResTags[k]) mergedTags[k] = baseTags[k];
        } else if (baseTags[k] !== headTags[k]) {
            mergedTags[k] = headTags[k] !== machineResTags[k]
                ? headTags[k]
                : baseTags[k];
        } else {
            mergedTags[k] = baseTags[k];
        }
    }

    for (var k in headTags) {
        if (!baseTags[k]) {
            // if the tag is newly added/updated in headTags, include it in
            // mergedTags. Otherwise delete it from mergedTags
            if (headTags[k] !== machineResTags[k]) {
                mergedTags[k] = headTags[k];
            }
        }
    }
    return mergedTags;
}
