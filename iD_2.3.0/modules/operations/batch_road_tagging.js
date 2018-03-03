import { t } from '../util/locale';
import { actionChangeTagsBatch } from '../actions/index';
import { behaviorOperation } from '../behavior/index';
import * as d3 from 'd3';

export function operationBatchRoadTagging(selectedIDs, context) {
    var action,
        ROAD_TYPE_WIN_HTML = "<b>Select road type</b><br/><br/>" +
            "<select id='rt_select' style='height:30px; width:200px;'>" +
            "<option>motorway</option>" +
            "<option>trunk</option>" +
            "<option>primary</option>" +
            "<option>secondary</option>" +
            "<option>tertiary</option>" +
            "<option>unclassified</option>" +
            "<option>residential</option>" +
            "<option>track</option>" +
            "<option>service</option>" +
            "<option>motorway_link</option>" +
            "<option>trunk_link</option>" +
            "<option>primary_link</option>" +
            "<option>secondary_link</option>" +
            "<option>tertiary_link</option>" +
            "<option>pedestrian</option>" +
            "</select>" +
            "<input id='rt_selected' type='hidden' value=''/>" +
            "<button id='ok_btn' " +
            "style='height:32px; width:50px;' " +
            "onclick=\"document.getElementById('rt_selected').value = " +
            "document.getElementById('rt_select').value; " +
            "window.close();\">OK</button>" +
            "<button id='cancel_btn' style='height:32px; width:80px;' " +
            "onclick=\"window.close();\">Cancel</button>",
        BRDIDGE_TAG_WIN_HTML = "<b>Select bridge layer</b><br/>" +
            "<select id='bl_select' style='height:30px; width:200px;'>" +
            "<option>1</option>" +
            "<option>2/option>" +
            "<option>3</option>" +
            "<option>4</option>" +
            "<option>-1</option>" +
            "<option>-2</option>" +
            "<option>-3</option>" +
            "<option>-4</option>" +
            "</select>" +
            "<input id='bl_selected' " + "type='hidden' value=''/>" +
            "<button id='ok_btn' style='height:32px; width:50px;' " +
            "onclick=\"document.getElementById('bl_selected').value = " +
            "document.getElementById('bl_select').value; window.close();\">" +
            "OK</button>" +
            "<button id='cancel_btn' style='height:32px; width:80px;' " +
            "onclick=\"window.close();\">Cancel</button>";

    function createRoadTypeWindow(settings) {
        var popup = window.open('about:blank', 'rt_window', settings);
        popup.document.write(ROAD_TYPE_WIN_HTML);
        return popup;
    }

    function createBridgeLayerWindow(settings) {
        var popup = window.open('about:blank', 'bl_window', settings);
        popup.document.write(BRDIDGE_TAG_WIN_HTML);
        return popup;
    }

    var operation = function() {
        var tag = null,
            w = 350, h = 150,
            winSettings = [
                ['width', w], ['height', h],
                ['left', screen.width / 2 - w / 2],
                ['top', screen.height / 2 - h / 2]
            ].map(function(x) {
                return x.join('=');
            }).join(',');

        if (d3.event.code === 'KeyU') tag = 'unclassified';
        else if (d3.event.code === 'KeyR') tag = 'residential';
        else if (d3.event.code === 'KeyT') tag = 'track';
        else if (d3.event.code === 'KeyI') tag = 'service';
        else if (d3.event.code === 'KeyE') tag = 'bridge';
        else if (d3.event.code === 'KeyJ') tag = 'unpaved';
        if (tag) {
            if (tag === 'bridge') {
                action = actionChangeTagsBatch(selectedIDs, {'bridge':'yes'});
            } else if (tag === 'unpaved') {
                action = actionChangeTagsBatch(selectedIDs,
                    {'surface':'unpaved'});
            } else {
                action = actionChangeTagsBatch(selectedIDs, {'highway':tag});
            }
            var annotation = t('operations.batch_road_tagging.annotation');
            context.perform(action, annotation);
        } else if (d3.event.code === 'KeyQ') {
            var popup = createRoadTypeWindow(winSettings),
                rtSelect = popup.document.getElementById('rt_select');
            rtSelect.addEventListener('keyup', function(event) {
                event.preventDefault();
                if (event.keyCode == 13) {
                    popup.document.getElementById('ok_btn').click();
                }
            });
            rtSelect.focus();

            popup.onunload = function() {
                var rt = popup.document.getElementById('rt_selected').value;
                if (rt) {
                    context.perform(
                        actionChangeTagsBatch(selectedIDs, {'highway':rt}),
                        t('operations.batch_road_tagging.annotation')
                    );
                }
            }
        } else if (d3.event.code === 'KeyP') {
            var popup = createBridgeLayerWindow(winSettings);
            var blSelect = popup.document.getElementById('bl_select');
            blSelect.addEventListener('keyup', function(event) {
                event.preventDefault();
                if (event.keyCode == 13) {
                    popup.document.getElementById('ok_btn').click();
                }
            });
            blSelect.focus();
            popup.onunload = function() {
                var layer = popup.document.getElementById('bl_selected').value;
                if(layer){
                    context.perform(
                        actionChangeTagsBatch(selectedIDs, {'layer':layer}),
                        t('operations.batch_road_tagging.annotation')
                    );
                }
            }
        }
    };

    operation.available = function() {
        return selectedIDs.every(function(id){return id.startsWith('w')});
    };

    operation.disabled = function() {
        return !selectedIDs.every(function(id){return id.startsWith('w-')});
    };

    operation.tooltip = function() {
        return operation.disabled() ?
            t('operations.batch_road_tagging.disabled') :
            t('operations.batch_road_tagging.description');
    };

    operation.annotation = function() {
        return t('operations.batch_road_tagging.annotation');
    };

    operation.id = 'batch_road_tagging';
    operation.keys = [
        t('operations.batch_road_tagging.keyR'),
        t('operations.batch_road_tagging.keyT'),
        t('operations.batch_road_tagging.keyU'),
        t('operations.batch_road_tagging.keyI'),
        t('operations.batch_road_tagging.keyQ'),
        t('operations.batch_road_tagging.keyE'),
        t('operations.batch_road_tagging.keyP'),
        t('operations.batch_road_tagging.keyJ')
    ];
    operation.title = t('operations.batch_road_tagging.title');

    operation.behavior = behaviorOperation(context).which(operation);

    return operation;
};
