import _ from 'lodash';
import { t } from '../util/locale';
import { actionDeleteMultiple } from './delete_multiple';
import { entTagsMerge, wayNodesMerge } from './merge_pos_way_xml';
import { posNodeManuallyChanged } from './merge_pos_node_xml';
import { geoSphericalDistance } from '../geo/geo';
import { osmEntity } from '../osm/index';
import { diff3_merge } from '../util/diff3';
import { dataDiscarded } from '../../data/index';


export function actionMergeRemoteChanges(id, localGraph, remoteGraph,
    formatUser) {
    // option values: 'safe', 'force_local', 'force_remote', 'force_merge'
    var option = 'safe',
        machineXMLEnts = null,
        conflicts = [];


    function user(d) {
        return _.isFunction(formatUser) ? formatUser(d) : d;
    }


    function mergeLocation(remote, target) {
        function pointEqual(a, b) {
            var epsilon = 1e-6;
            return (Math.abs(a[0] - b[0]) < epsilon) &&
                (Math.abs(a[1] - b[1]) < epsilon);
        }

        if (option === 'force_local' || pointEqual(target.loc, remote.loc)) {
            return target;
        }
        if (option === 'force_remote') {
            return target.update({loc: remote.loc});
        }
        if (option === 'force_merge') {
            // target's initial loc and tags were set by local graph
            if (target.tags.edited === 'true') {
                return target;
            } else {
                return target.update({loc: remote.loc});
            }
        }

        conflicts.push(t(
            'merge_remote_changes.conflict.location',
            { user: user(remote.user) }
        ));
        return target;
    }


    function mergeNodes(base, remote, target) {
        if (option === 'force_local' || _.isEqual(target.nodes, remote.nodes)) {
            return target;
        }
        if (option === 'force_remote') {
            return target.update({nodes: remote.nodes});
        }
        if (option === 'force_merge') {
            var mergedNids = wayNodesMerge(remote.nodes, target.nodes,
                    remoteGraph.entities, localGraph.entities, machineXMLEnts);
            return mergedNids !== null
                ? target.update({nodes: mergedNids})
                : target.update({nodes: remote.nodes});
        }

        // if target contains negative nodes or positive nodes used in negative
        // ways, raise a conflict
        var remoteNodes = new Set(remote.nodes);
        for (var i = 0; i < target.nodes.length; i++) {
            var nid = target.nodes[i];
            if (nid[1] === '-') {
                conflicts.push(t(
                    'merge_remote_changes.conflict.nodelist',
                    { user: user(remote.user) }
                ));
                return target;
            } else if (!remoteNodes.has(nid)) {
                var pwids = localGraph._parentWays[nid];
                for (var j = 0; j < pwids.length; j++) {
                    if (pwids[j][1] === '-') {
                        conflicts.push(t(
                            'merge_remote_changes.conflict.nodelist',
                            { user: user(remote.user) }
                        ));
                        return target;
                    }
                }
            }
        }

        var ccount = conflicts.length,
            o = base.nodes || [],
            a = target.nodes || [],
            b = remote.nodes || [],
            nodes = [],
            hunks = diff3_merge(a, o, b, true);

        for (var i = 0; i < hunks.length; i++) {
            var hunk = hunks[i];
            if (hunk.ok) {
                nodes.push.apply(nodes, hunk.ok);
            } else {
                // for all conflicts, we can assume c.a !== c.b
                // because `diff3_merge` called with `true` option to exclude
                // false conflicts..
                var c = hunk.conflict;
                if (_.isEqual(c.o, c.a)) {  // only changed remotely
                    nodes.push.apply(nodes, c.b);
                } else if (_.isEqual(c.o, c.b)) {  // only changed locally
                    nodes.push.apply(nodes, c.a);
                } else {       // changed both locally and remotely
                    conflicts.push(t(
                        'merge_remote_changes.conflict.nodelist',
                        { user: user(remote.user) })
                    );
                    break;
                }
            }
        }

        return (conflicts.length === ccount)
            ? target.update({nodes: nodes})
            : target;
    }


    function mergeChildren(targetWay, children, updates, graph) {
        function isUsed(node, targetWay) {
            var parentWays = _.map(graph.parentWays(node), 'id');
            return node.hasInterestingTags() ||
                _.without(parentWays, targetWay.id).length > 0 ||
                graph.parentRelations(node).length > 0;
        }

        var ccount = conflicts.length;

        for (var i = 0; i < children.length; i++) {
            var id = children[i],
                node = graph.hasEntity(id),
                local = localGraph.hasEntity(id),
                remote = remoteGraph.hasEntity(id),
                target;

            // remove unused childNodes..
            if (targetWay.nodes.indexOf(id) === -1) {
                if (node && !isUsed(node, targetWay)) {
                    updates.removeIds.push(id);
                }
                continue;
            }

            // restore used childNodes..
            if (option === 'force_remote' && remote && remote.visible) {
                updates.replacements.push(remote);
            } else if (option === 'force_local' && local) {
                target = osmEntity(local);
                if (remote) {
                    target = target.update({ version: remote.version });
                }
                updates.replacements.push(target);
            } else if (option === 'force_merge') {
                if (local && remote && remote.visible &&
                    local.version !== remote.version) {
                    target = osmEntity(local, { version: remote.version });
                    target = mergeLocation(remote, target);
                    target = mergeTags(graph.base().entities[id], remote,
                        target);
                } else if (remote && remote.visible && !local) {
                    target = osmEntity(remote);
                }
                if (target) updates.replacements.push(target);
            } else if (option === 'safe' && local && remote &&
                local.version !== remote.version) {
                target = osmEntity(local, { version: remote.version });
                if (remote.visible) {
                    target = mergeLocation(remote, target);
                    target = mergeTags(graph.base().entities[id], remote,
                        target);
                } else {
                    conflicts.push(t(
                        'merge_remote_changes.conflict.deleted',
                        { user: user(remote.user) }
                    ));
                }

                if (conflicts.length !== ccount) break;
                updates.replacements.push(target);
            }
        }

        return targetWay;
    }


    function updateChildren(updates, graph) {
        for (var i = 0; i < updates.replacements.length; i++) {
            graph = graph.replace(updates.replacements[i]);
        }
        if (updates.removeIds.length) {
            graph = actionDeleteMultiple(updates.removeIds)(graph);
        }
        return graph;
    }


    function mergeMembers(remote, target) {
        if (option === 'force_local' ||
            _.isEqual(target.members, remote.members)) {
            return target;
        }
        if (option === 'force_remote') {
            return target.update({members: remote.members});
        }

        conflicts.push(t(
            'merge_remote_changes.conflict.memberlist',
            { user: user(remote.user) }
        ));
        return target;
    }


    function mergeTags(base, remote, target) {
        function ignoreKey(k) {
            return _.includes(dataDiscarded, k);
        }

        if (option === 'force_local' || _.isEqual(target.tags, remote.tags)) {
            return target;
        }
        if (option === 'force_remote') {
            return target.update({tags: remote.tags});
        }
        if (option === 'force_merge') {
            var mergedTags = entTagsMerge(remote, target,
                    machineXMLEnts ? machineXMLEnts[target.id] : null);
            return target.update({tags: mergedTags});
        }

        var ccount = conflicts.length,
            o = base.tags || {},
            a = target.tags || {},
            b = remote.tags || {},
            keys = _.reject(_.union(_.keys(o), _.keys(a), _.keys(b)),
                ignoreKey),
            tags = _.clone(a),
            changed = false;

        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];

            if (o[k] !== b[k] && a[k] !== b[k]) {    // changed remotely..
                if (o[k] !== a[k]) {      // changed locally..
                    conflicts.push(t(
                        'merge_remote_changes.conflict.tags',
                        {
                            tag: k,
                            local: a[k],
                            remote: b[k],
                            user: user(remote.user)
                        }
                    ));
                } else {  // unchanged locally, accept remote change..
                    if (b.hasOwnProperty(k)) {
                        tags[k] = b[k];
                    } else {
                        delete tags[k];
                    }
                    changed = true;
                }
            }
        }

        return (changed && conflicts.length === ccount)
            ? target.update({tags: tags})
            : target;
    }


    //  `graph.base()` is the common ancestor of the two graphs.
    //  `localGraph` contains user's edits up to saving
    //  `remoteGraph` contains remote edits to modified nodes
    //  `graph` must be a descendent of `localGraph` and may include
    //      some conflict resolution actions performed on it.
    //
    //                  --- ... --- `localGraph` -- ... -- `graph`
    //                 /
    //  `graph.base()` --- ... --- `remoteGraph`
    //
    var action = function(graph) {
        var updates = { replacements: [], removeIds: [] },
            base = graph.base().entities[id],
            local = localGraph.entity(id),
            remote = remoteGraph.entity(id),
            target = osmEntity(local, { version: remote.version });

        // delete/undelete
        if (!remote.visible) {
            if (option === 'force_remote') {
                return actionDeleteMultiple([id])(graph);

            } else if (option === 'force_local') {
                if (target.type === 'way') {
                    target = mergeChildren(target, _.uniq(local.nodes),
                        updates, graph);
                    graph = updateChildren(updates, graph);
                }
                return graph.replace(target);

            } else {
                conflicts.push(t(
                    'merge_remote_changes.conflict.deleted',
                    { user: user(remote.user) }
                ));
                return graph;  // do nothing
            }
        }

        // merge
        if (target.type === 'node') {
            target = mergeLocation(remote, target);

        } else if (target.type === 'way') {
            // pull in any child nodes that may not be present locally..
            graph.rebase(remoteGraph.childNodes(remote), [graph], false);
            target = mergeNodes(base, remote, target);
            target = mergeChildren(target, _.union(local.nodes, remote.nodes),
                updates, graph);
        } else if (target.type === 'relation') {
            target = mergeMembers(remote, target);
        }

        target = mergeTags(base, remote, target);

        if (!conflicts.length) {
            graph = updateChildren(updates, graph).replace(target);
        }

        return graph;
    };


    action.withOption = function(opt) {
        option = opt;
        return action;
    };


    action.withMachineXMLEnts = function(machineEnts) {
        machineXMLEnts = machineEnts;
        return action;
    }


    action.conflicts = function() {
        return conflicts;
    };


    return action;
}
