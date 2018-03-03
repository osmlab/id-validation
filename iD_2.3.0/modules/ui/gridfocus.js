export function uiGridFocus(context) {
    var map = context.map(),
        background = context.background(),
        numGridSplits = background.numGridSplits(),
        CONTROL_SIZE = 40;

    function drawMiniGrids(svgSelect) {
        var gridWidth = CONTROL_SIZE / numGridSplits;
        for (var i = 1; i < numGridSplits; i++) {
            svgSelect.append("line")
                .attr("x1", 0)
                .attr("y1", i * gridWidth)
                .attr("x2", CONTROL_SIZE)
                .attr("y2", i * gridWidth)
                .attr("stroke-width", 1)
                .style("stroke", "white");

            svgSelect.append("line")
                .attr("x1", i * gridWidth)
                .attr("y1", 0)
                .attr("x2", i * gridWidth)
                .attr("y2", CONTROL_SIZE)
                .attr("stroke-width", 1)
                .style("stroke", "white");
        }
    };

    return function(selection) {
        var svgSelect = selection.append('button')
            .attr('tabindex', -1)
            .selectAll('svg')
            .data([0])
            .enter()
            .append('svg')
            .attr("width", CONTROL_SIZE)
            .attr("height", CONTROL_SIZE);

        drawMiniGrids(svgSelect);
        map.on('move.grid_focus', function() {
            var bounds = context.getMapBounds();
            if (!bounds) return;

            var center = map.center(),
                cx = Math.round((center[0] - bounds.minlon) * CONTROL_SIZE /
                    (bounds.maxlon - bounds.minlon)),
                cy = Math.round((bounds.maxlat - center[1]) * CONTROL_SIZE /
                    (bounds.maxlat - bounds.minlat));
            svgSelect.selectAll("circle").remove();
            svgSelect.append("circle")
                .attr("cx", cx)
                .attr("cy", cy)
                .attr("r", 3)
                .style("fill", "yellow");
        });

        background.on('change.grid_focus', function() {
            var curNumGridSplits = background.numGridSplits();
            if (curNumGridSplits !== numGridSplits) {
                svgSelect.selectAll("line").remove();
                numGridSplits = curNumGridSplits;
                drawMiniGrids(svgSelect);
            }
        });
    };
}
