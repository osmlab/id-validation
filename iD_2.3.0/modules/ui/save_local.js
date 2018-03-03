import * as d3 from 'd3';
import _ from 'lodash';
import { d3keybinding } from '../lib/d3.keybinding.js';
import { t } from '../util/locale';
import { uiCmd } from './cmd';
import { uiTooltipHtml } from './tooltipHtml';
import { tooltip } from '../util/tooltip';
import { isObjectEmptyWithProto } from '../util';


export function uiSaveLocal(context) {
    var key = uiCmd('\u2318\u21E7S');

    function saveXmlToLocal(content, fileName, contentType) {
        if(!contentType) contentType = 'application/xml';
        var a = document.createElement('a');
        var blob = new Blob([content], {'type':contentType});
        a.href = window.URL.createObjectURL(blob);
        a.download = fileName ? fileName : 'id_osm_data.xml';
        document.body.appendChild(a);
        if (confirm('Save file to local directory?')) {
            a.click();
        }
        setTimeout(function(){
            document.body.removeChild(a);
            window.URL.revokeObjectURL(a.href);
        }, 100);
    }

    function save() {
        d3.event.preventDefault();
        var fileName = context.osmFileName();
        var xml_ = context.genXMLStringFromGraph();
        if (xml_) {
            saveXmlToLocal(xml_, fileName, "application/xml");
        }
    }

    return function(selection) {
        var tooltipBehavior = tooltip()
            .placement('bottom')
            .html(true)
            .title(uiTooltipHtml(t('save_local.help'), key));

        var button = selection.append('button')
            .attr('class', 'save_local col13 disabled')
            .attr('tabindex', -1)
            .on('click', save)
            .call(tooltipBehavior);

        button.append('span')
            .attr('class', 'label')
            .text(t('save_local.title'));

        context.history().on('change.save_local', function() {
            var entities = context.graph().entities,
                bounds = context.getMapBounds();
            button.classed('disabled',
                isObjectEmptyWithProto(entities) || !bounds);
        });
    };
}
