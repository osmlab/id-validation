import _ from 'lodash';

export function actionChangeTagsBatch(entityIds, tags) {
    return function(graph) {
        _.each(entityIds, function(entityId){
            var entity = graph.entity(entityId),
                newTags = _.assign({}, entity.tags, tags);
            newTags = adjustTagsBeforeUpdateEnt(entity, newTags,
                graph.isForXMLEditing());
            graph = graph.replace(entity.update({tags: newTags}));
        });
        return graph;
    };
}

export function adjustTagsBeforeUpdateEnt(entity, tags, isForXMLEditing) {
    if (!tags.highway) return tags;
    var adjusted = _.cloneDeep(tags);
    if (isForXMLEditing && entity.id[1] === '-' && !adjusted.source) {
        adjusted.source = 'digitalglobe';
    }
    if (isForXMLEditing && entity.id[1] === '-' && !adjusted.import) {
        adjusted.import = 'yes';
    }
    if (adjusted.highway === 'track' && !entity.tags.surface) {
        adjusted.surface = 'unpaved';
    }
    if (entity.tags.highway === 'track' && adjusted.highway !== 'track' &&
        adjusted.surface === 'unpaved') {
        delete adjusted.surface;
    }
    if (adjusted.bridge && !adjusted.layer) {
        adjusted.layer = '1';
    }
    return adjusted;
}
