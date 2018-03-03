import * as d3 from 'd3';
import { d3keybinding } from '../lib/d3.keybinding.js';
import { t } from '../util/locale';
import { modeSave, modeSelect } from '../modes/index';
import { svgIcon } from '../svg/index';
import { uiCmd } from './cmd';
import { uiTooltipHtml } from './tooltipHtml';
import { tooltip } from '../util/tooltip';


export function uiSave(context) {
    var history = context.history(),
        key = uiCmd('\u2318S');


    function saving() {
        return context.mode().id === 'save';
    }


    function save() {
        if (context.mapperRole() === context.EDITOR_ROLE ||
            context.isReadOnlyMode() || context.inIntro() || saving() ||
            !history.hasChanges()) {
            return;
        }
        d3.event.preventDefault();
        if (context.editInBoundsMode() === context.EDIT_IN_BOUNDS_FROM_OSM_XML)
        {
            if (context.dataInBoundsLoadState() !==
                context.DATA_IN_BOUNDS_LOADED) {
                return;
            }
            var errObj = context.findNextError(true);
            if (errObj) {
                var msg = t('save.mm_error_promt')
                        .replace('{eid}', errObj.eid)
                        .replace('{msg}', context.ERR_TYPE_MSG[errObj.error]);
                alert(msg);
                var errorEnt = context.entity(errObj.eid);
                context.map().zoomTo(errorEnt);
                if (context.map().zoom() > context.maxEntHighlightZoom()) {
                    context.map().zoom(context.maxEntHighlightZoom());
                }
                context.enter(
                    modeSelect(context, [errorEnt.id]).suppressMenu(true)
                );
                return;
            }
            var curErrList = context.getErrorList();
            if (curErrList && curErrList.length > 0) {
                var msg = t('save.mm_warning_promt') + "\n";
                curErrList.forEach(function(errEle) {
                    msg += errEle.eid + ": " +
                        context.ERR_TYPE_MSG[errEle.error] + "\n";
                });
                if (!confirm(msg)) return;
            }
        }
        context.enter(modeSave(context));
    }


    function getBackground(numChanges) {
        var step;
        if (numChanges === 0) {
            return null;
        } else if (numChanges <= 50) {
            step = numChanges / 50;
            return d3.interpolateRgb('#fff', '#ff8')(step);  // white -> yellow
        } else {
            step = Math.min((numChanges - 50) / 50, 1.0);
            return d3.interpolateRgb('#ff8', '#f88')(step);  // yellow -> red
        }
    }


    return function(selection) {
        var numChanges = 0;

        function updateCount() {
            var _ = history.difference().summary().length;
            if (_ === numChanges) return;
            numChanges = _;

            tooltipBehavior
                .title(uiTooltipHtml(
                    t(numChanges > 0 ? 'save.help' : 'save.no_changes'), key)
                );

            var background = getBackground(numChanges);

            button
                .classed('disabled', numChanges === 0 ||
                    context.mapperRole() === context.EDITOR_ROLE ||
                    context.isReadOnlyMode())
                .classed('has-count', numChanges > 0)
                .style('background', background);

            button.select('span.count')
                .text(numChanges)
                .style('background', background)
                .style('border-color', background);
        }


        var tooltipBehavior = tooltip()
            .placement('bottom')
            .html(true)
            .title(uiTooltipHtml(t('save.no_changes'), key));

        var button = selection
            .append('button')
            .attr('class', 'save col12 disabled')
            .attr('tabindex', -1)
            .on('click', save)
            .call(tooltipBehavior);

        button
            .call(svgIcon('#icon-save', 'pre-text'))
            .append('span')
            .attr('class', 'label')
            .text(t('save.title'));

        button
            .append('span')
            .attr('class', 'count')
            .text('0');

        updateCount();


        var keybinding = d3keybinding('save')
            .on(key, save, true);

        d3.select(document)
            .call(keybinding);

        context.history()
            .on('change.save', updateCount);

        context
            .on('enter.save', function() {
                button.property('disabled', saving());
                if (saving()) button.call(tooltipBehavior.hide);
            });
    };
}
