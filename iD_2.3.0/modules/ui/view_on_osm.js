import { t } from '../util/locale';
import { svgIcon } from '../svg/index';


export function uiViewOnOSM(context) {
    var id;

    function viewOnOSM(selection) {
        var entity = context.entity(id);

        var link = selection.selectAll('.view-on-osm')
            .data([0]);

        if (entity.isNew()) {
            link.enter()
                .append('div')
                .attr('class', 'view-on-osm')
                .text(id);
        } else {
            var enter = link.enter()
                .append('a')
                .attr('class', 'view-on-osm')
                .attr('target', '_blank')
                .call(svgIcon('#icon-out-link', 'inline'));

            enter
                .append('span')
                .text(t('inspector.view_on_osm') + ': ' + id);

            link
                .merge(enter)
                .attr('href', context.connection().entityURL(entity));
        }
    }


    viewOnOSM.entityID = function(_) {
        if (!arguments.length) return id;
        id = _;
        return viewOnOSM;
    };

    return viewOnOSM;
}
