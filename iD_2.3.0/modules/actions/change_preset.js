import { adjustTagsBeforeUpdateEnt } from './change_tags_batch'

export function actionChangePreset(entityId, oldPreset, newPreset) {
    return function(graph) {
        var entity = graph.entity(entityId),
            geometry = entity.geometry(graph),
            tags = entity.tags;

        if (oldPreset) tags = oldPreset.removeTags(tags, geometry);
        if (newPreset) tags = newPreset.applyTags(tags, geometry);
        tags = adjustTagsBeforeUpdateEnt(entity, tags, graph.isForXMLEditing());

        return graph.replace(entity.update({tags: tags}));
    };
}
