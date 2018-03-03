import * as d3 from 'd3';
import _ from 'lodash';

import { t } from '../util/locale';
import { JXON } from '../util/jxon';

import {
    actionDiscardTags,
    actionMergeRemoteChanges,
    actionNoop,
    actionRevert
} from '../actions';

import { coreGraph } from '../core';
import { modeBrowse } from './index';

import {
    uiConflicts,
    uiConfirm,
    uiCommit,
    uiLoading,
    uiSuccess
} from '../ui';

import {
    utilDisplayName,
    utilDisplayType
} from '../util';



export function modeSave(context) {
    var mode = {
        id: 'save'
    };

    var commit = uiCommit(context)
            .on('cancel', cancel)
            .on('save', save);


    function cancel() {
        if (context.editInBoundsMode() === context.EDIT_IN_BOUNDS_FROM_OSM_XML
            &&
            context.dataInBoundsLoadState() === context.DATA_IN_BOUNDS_LOADED) {
            context.allowAutoTagging(true);
        }
        context.enter(modeBrowse(context));
    }


    function save(changeset, tryAgain) {
        context.allowAutoTagging(false);

        var loading = uiLoading(context).message(t('save.uploading')).blocking(
                true),
            history = context.history(),
            origChanges = history.changes(actionDiscardTags(
                history.difference())),
            localGraph = context.graph(),
            remoteGraph = coreGraph(context, history.base(), true),
            modified = _.filter(history.difference().summary(),
                {changeType: 'modified'}),
            toCheck = _.map(_.map(modified, 'entity'), 'id'),
            toLoad = withChildNodes(toCheck, localGraph),
            conflicts = [],
            errors = [];

        if (!tryAgain) {
            history.perform(actionNoop(), 'save_mark_noop');  // checkpoint
        }

        context.container().call(loading);

        if (toCheck.length) {
            context.connection().loadMultiple(toLoad, loaded);
        } else {
            upload();
        }


        function withChildNodes(ids, graph) {
            return _.uniq(_.reduce(ids, function(result, id) {
                var entity = graph.entity(id);
                if (entity.type === 'way') {
                    try {
                        var cn = graph.childNodes(entity);
                        result.push.apply(result,
                            _.map(_.filter(cn, 'version'), 'id'));
                    } catch (err) {
                        /* eslint-disable no-console */
                        if (typeof console !== 'undefined') console.error(err);
                        /* eslint-enable no-console */
                    }
                }
                return result;
            }, _.clone(ids)));
        }


        // Reload modified entities into an alternate graph and check for
        // conflicts..
        function loaded(err, result) {
            if (errors.length) return;

            if (err) {
                errors.push({
                    msg: err.responseText,
                    details: [ t('save.status_code', { code: err.status }) ]
                });
                showErrors();

            } else {
                var loadMore = [];
                _.each(result.data, function(entity) {
                    remoteGraph.replace(entity);
                    toLoad = _.without(toLoad, entity.id);

                    // Because loadMultiple doesn't download /full like
                    // loadEntity, need to also load children that aren't
                    // already being checked..
                    if (!entity.visible) return;
                    if (entity.type === 'way') {
                        loadMore.push.apply(loadMore, _.difference(
                            entity.nodes, toCheck, toLoad, loadMore));
                    } else if (entity.type === 'relation' &&
                        entity.isMultipolygon()) {
                        loadMore.push.apply(
                            loadMore,
                            _.difference(
                                _.map(entity.members, 'id'),
                                toCheck,
                                toLoad,
                                loadMore
                            )
                        );
                    }
                });

                if (loadMore.length) {
                    toLoad.push.apply(toLoad, loadMore);
                    context.connection().loadMultiple(loadMore, loaded);
                }

                if (!toLoad.length) {
                    checkConflicts();
                }
            }
        }


        function checkConflicts() {
            function choice(id, text, action) {
                return {
                    id: id,
                    text: text,
                    action: function() {
                        var anno = history.annotation();
                        if (anno && anno.startsWith('save_conflict_' + id)) {
                            history.pop();
                        }
                        history.perform(action, 'save_conflict_' + id);
                    }
                };
            }
            function formatUser(d) {
                return '<a href="' + context.connection().userURL(d) +
                    '" target="_blank">' + d + '</a>';
            }
            function entityName(entity) {
                return utilDisplayName(entity) ||
                    (utilDisplayType(entity.id) + ' ' + entity.id);
            }

            function compareVersions(local, remote) {
                if (local.version !== remote.version) return false;

                if (local.type === 'way') {
                    var children = _.union(local.nodes, remote.nodes);

                    for (var i = 0; i < children.length; i++) {
                        var a = localGraph.hasEntity(children[i]),
                            b = remoteGraph.hasEntity(children[i]);

                        if (a && b && a.version !== b.version) return false;
                    }
                }

                return true;
            }

            _.each(toCheck, function(id) {
                var local = localGraph.entity(id),
                    remote = remoteGraph.entity(id);

                if (compareVersions(local, remote)) return;

                var action = actionMergeRemoteChanges,
                    merge = action(id, localGraph, remoteGraph, formatUser);

                history.replace(merge, 'save_mark_replace');

                var mergeConflicts = merge.conflicts();
                if (!mergeConflicts.length) return;  // merged safely

                var forceLocal = action(id, localGraph, remoteGraph)
                        .withOption('force_local'),
                    forceRemote = action(id, localGraph, remoteGraph)
                        .withOption('force_remote'),
                    keepMine = t('save.conflict.' +
                        (remote.visible ? 'keep_local' : 'restore')),
                    keepTheirs = t('save.conflict.' +
                        (remote.visible ? 'keep_remote' : 'delete'));

                if (context.editInBoundsMode() ===
                    context.EDIT_IN_BOUNDS_FROM_OSM_XML &&
                    remote.visible && (id[0] === 'n' || id[0] === 'w')) {
                    var forceConfMerge = action(id, localGraph, remoteGraph)
                            .withOption('force_merge')
                            .withMachineXMLEnts(context.osmXMLEntitiesBase()),
                        keepBoth = t('save.conflict.force_merge');
                    conflicts.push({
                        id: id,
                        name: entityName(local),
                        details: mergeConflicts,
                        chosen: 2,
                        choices: [
                            choice(id, keepMine, forceLocal),
                            choice(id, keepTheirs, forceRemote),
                            choice(id, keepBoth, forceConfMerge)
                        ]
                    });
                } else {
                    conflicts.push({
                        id: id,
                        name: entityName(local),
                        details: mergeConflicts,
                        chosen: 1,
                        choices: [
                            choice(id, keepMine, forceLocal),
                            choice(id, keepTheirs, forceRemote)
                        ]
                    });
                }
            });

            upload();
        }


        function validateChanges(changes, remoteGraph) {
            if (context.editInBoundsMode() !==
                context.EDIT_IN_BOUNDS_FROM_OSM_XML) {
                return true;
            }
            // check if any created entity has positive id
            var badIds = changes.created
                .filter(function (ch) { return ch.id[1] !== '-'; })
                .map(function (ch) { return ch.id; });
            if (badIds.length > 0) {
                alert(t('save.mm_error_create_id') + '\n' + badIds.join('\n'));
                return false;
            }

            // check for deleted entities
            badIds = changes.deleted
                .filter(function (ch) {
                    return ch.id[0] !== 'n' || ch.id[1] === '-';
                })
                .map(function (ch) { return ch.id; });
            if (badIds.length > 0) {
                alert(t('save.mm_error_delete_id') + '\n' + badIds.join('\n'));
                return false;
            }

            // check for modified relations
            badIds = changes.modified
                .filter(function (ch) { return ch.id[0] === 'r'; })
                .map(function (ch) { return ch.id; });
            if (badIds.length > 0) {
                alert(t('save.mm_error_modify_rel') + '\n' + badIds.join('\n'));
                return false;
            }

            // check if tags of existing entities have been changed
            var tagChanges = [];
            _.each(changes.modified, function(ent) {
                var remoteEnt = remoteGraph.entities[ent.id];
                if (ent.id[1] !== '-' && remoteEnt) {
                    var changeStr = '';
                    for (var k in remoteEnt.tags) {
                        if (!ent.tags[k]) {
                            changeStr += k + ': ' + remoteEnt.tags[k] +
                                ' -> NULL; ';
                        } else if (remoteEnt.tags[k] !== ent.tags[k]) {
                            changeStr += k + ': ' + remoteEnt.tags[k] + ' -> '
                                + ent.tags[k] + '; ';
                        }
                    }
                    for (var k in ent.tags) {
                        if (!remoteEnt.tags[k]) {
                            changeStr += k + ': NULL -> ' + ent.tags[k] + '; ';
                        }
                    }
                    if (changeStr.length > 0) {
                        tagChanges.push(ent.id + ': ' + changeStr);
                    }
                }
            });
            if (tagChanges.length > 0) {
                return confirm(t('save.mm_warning_tag_change') + '\n\n' +
                     tagChanges.join('\n'));
            }

            return true;
        }


        function upload() {
            if (conflicts.length) {
                conflicts.sort(
                    function(a,b) { return b.id.localeCompare(a.id); });
                showConflicts();
            } else if (errors.length) {
                showErrors();
            } else {
                var changes = history.changes(
                    actionDiscardTags(history.difference()));
                if (validateChanges(changes, remoteGraph) &&
                    (changes.modified.length || changes.created.length ||
                    changes.deleted.length)) {
                    context.connection().putChangeset(changeset, changes,
                        uploadCallback);
                } else {  // changes were insignificant or reverted by user
                    d3.select('.inspector-wrap *').remove();
                    loading.close();
                    context.flush();
                    cancel();
                }
            }
        }


        function uploadCallback(err, changeset) {
            if (err) {
                errors.push({
                    msg: err.responseText,
                    details: [ t('save.status_code', { code: err.status }) ]
                });
                showErrors();
            } else {
                history.clearSaved();
                success(changeset);
                // Add delay to allow for postgres replication #1646 #2678
                window.setTimeout(function() {
                    d3.select('.inspector-wrap *').remove();
                    loading.close();
                    context.flush();
                }, 2500);
            }
        }


        function showConflicts() {
            var selection = context.container()
                .select('#sidebar')
                .append('div')
                .attr('class','sidebar-component');

            loading.close();

            selection.call(uiConflicts(context)
                .list(conflicts)
                .on('download', function() {
                    var data = JXON.stringify(
                            changeset.update({ id: 'CHANGEME' }
                        ).osmChangeJXON(origChanges)),
                        win = window.open('data:text/xml,' +
                            encodeURIComponent(data), '_blank');
                    win.focus();
                })
                .on('cancel', function() {
                    // 'save_mark_*' marks the first graph after entering save
                    // mode
                    while (!history.annotation() ||
                        !history.annotation().startsWith('save_mark_')) {
                        history.pop();
                    }
                    history.pop();
                    selection.remove();
                })
                .on('save', function() {
                    for (var i = 0; i < conflicts.length; i++) {
                        if (conflicts[i].chosen === 1) {
                            // user chose 'keep theirs'
                            var entity = context.hasEntity(conflicts[i].id);
                            if (entity && entity.type === 'way') {
                                var children = _.uniq(entity.nodes);
                                for (var j = 0; j < children.length; j++) {
                                    history.replace(actionRevert(children[j]));
                                }
                            }
                            history.replace(actionRevert(conflicts[i].id));
                        }
                    }

                    selection.remove();
                    save(changeset, true);
                })
            );
        }


        function showErrors() {
            var selection = uiConfirm(context.container());

            history.pop();
            loading.close();

            selection
                .select('.modal-section.header')
                .append('h3')
                .text(t('save.error'));

            addErrors(selection, errors);
            selection.okButton();
        }


        function addErrors(selection, data) {
            var message = selection
                .select('.modal-section.message-text');

            var items = message
                .selectAll('.error-container')
                .data(data);

            var enter = items.enter()
                .append('div')
                .attr('class', 'error-container');

            enter
                .append('a')
                .attr('class', 'error-description')
                .attr('href', '#')
                .classed('hide-toggle', true)
                .text(function(d) {
                    return d.msg || t('save.unknown_error_details');
                }).on('click', function() {
                    var error = d3.select(this),
                        detail = d3.select(this.nextElementSibling),
                        exp = error.classed('expanded');

                    detail.style('display', exp ? 'none' : 'block');
                    error.classed('expanded', !exp);

                    d3.event.preventDefault();
                });

            var details = enter
                .append('div')
                .attr('class', 'error-detail-container')
                .style('display', 'none');

            details
                .append('ul')
                .attr('class', 'error-detail-list')
                .selectAll('li')
                .data(function(d) { return d.details || []; })
                .enter()
                .append('li')
                .attr('class', 'error-detail-item')
                .text(function(d) { return d; });

            items.exit()
                .remove();
        }

    }


    function success(changeset) {
        commit.reset();
        context.enter(modeBrowse(context)
            .sidebar(uiSuccess(context)
                .changeset(changeset)
                .on('cancel', function() {
                    context.ui().sidebar.hide();
                })
            )
        );
    }


    mode.enter = function() {
        function done() {
            context.ui().sidebar.show(commit);
        }

        context.container().selectAll('#content')
            .attr('class', 'inactive');

        if (context.connection().authenticated()) {
            done();
        } else {
            context.connection().authenticate(function(err) {
                if (err) {
                    cancel();
                } else {
                    done();
                }
            });
        }
    };


    mode.exit = function() {
        context.container().selectAll('#content')
            .attr('class', 'active');

        context.ui().sidebar.hide();
    };

    return mode;
}
