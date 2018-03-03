import * as d3 from 'd3';
import { t } from '../util/locale';
import { modeSelect } from '../modes/index';
import { tooltip } from '../util/tooltip';
import { uiTooltipHtml } from './tooltipHtml';

export function uiPreviousError(context) {
    var history = context.history();

    function findError() {
        d3.event.preventDefault();
        if (!context.getMapBounds()) return;

        var errObj = context.findPreviousError();
        if (!errObj) {
            alert(t('validations.no_previous_error'));
            return;
        }
        var errorEnt = context.entity(errObj.eid);
        context.map().zoomTo(errorEnt);
        if (context.map().zoom() > context.maxEntHighlightZoom()) {
            context.map().zoom(context.maxEntHighlightZoom());
        }
        context.enter(modeSelect(context, [errorEnt.id]).suppressMenu(true));
    }

    return function(selection) {
        var tt = tooltip()
            .placement('bottom')
            .html(true)
            .title(uiTooltipHtml(t('validations.previous_error_tip')));
        var button = selection.append('button')
            .attr('class', 'prev_error col13 disabled')
            .attr('id', 'prev_error_btn')
            .attr('tabindex', -1)
            .on('click', findError)
            .call(tt);
        button.append('span')
            .attr('class', 'label')
            .text(t('validations.previous_error'));

        context.history().on('change.prev_error', function() {
            button.classed('disabled', (!context.getMapBounds()));
        });
    };
}
