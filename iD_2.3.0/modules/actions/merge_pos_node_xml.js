import _ from 'lodash';
import { entTagsMerge } from './merge_pos_way_xml';

export function actionMergePosNodeFromXML(nid, entsInXML, entsInBaseXML) {
    return function(graph) {
        var nodeFromXML = entsInXML[nid],
            nodeFromBaseXML = entsInBaseXML ? entsInBaseXML[nid] : undefined,
            nodeInGraph = graph.hasEntity(nid);
        if (!nodeInGraph || !nodeInGraph.visible) {
            // nid is not there anymore in live OSM, so we choose not to merge.
            // logic in function wayNodesMerge also ensures nid is removed from
            // ways in XML.
            return graph;
        }

        var updates = {};
        if (nodeLocDiff(nodeFromXML, nodeInGraph) &&
            (!nodeFromBaseXML || nodeLocDiff(nodeFromXML, nodeFromBaseXML))
        ) {
            updates.loc = [nodeFromXML.loc[0], nodeFromXML.loc[1]];
        }

        if (!_.isEqual(nodeFromXML.tags, nodeInGraph.tags) &&
            (!nodeFromBaseXML ||
                !_.isEqual(nodeFromXML.tags, nodeFromBaseXML.tags))
        ) {
            updates.tags = entTagsMerge(nodeInGraph, nodeFromXML,
                nodeFromBaseXML);
        }

        if (nodeFromXML.visible !== nodeInGraph.visible &&
            (!nodeFromBaseXML ||
                nodeFromXML.visible !== nodeFromBaseXML.visible)
        ) {
            updates.visible = nodeFromXML.visible;
        }

        return _.isEmpty(updates)
            ? graph
            : graph.replace(nodeInGraph.update(updates));
    };
}

export function nodeLocDiff(n1, n2) {
    return Math.abs(n1.loc[0] - n2.loc[0]) >= 1e-6 ||
        Math.abs(n1.loc[1] - n2.loc[1]) >= 1e-6
}

// check if a positive node in XML file has changed by comparing to its status
// in machine-generated XML (entsInBaseXML)
export function posNodeManuallyChanged(nid, entsInXML, entsInBaseXML) {
    var n1 = entsInXML[nid],
        n2 = entsInBaseXML ? entsInBaseXML[nid] : undefined;

    if (!n1) return n2 && n2.visible;

    return n1.tags.edited === 'true';
}
