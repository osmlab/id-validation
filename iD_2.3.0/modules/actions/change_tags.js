import { adjustTagsBeforeUpdateEnt } from './change_tags_batch'

export function actionChangeTags(entityId, tags) {
    return function(graph) {
        var entity = graph.entity(entityId);
        tags = adjustTagsBeforeUpdateEnt(entity, tags, graph.isForXMLEditing());
        graph = graph.replace(entity.update({tags: tags}));
        if (entityId.startsWith('w-') && entity.tags.lint_disconnected
            && !tags.lint_disconnected) {
            graph = graph.removeReachableDisconnectedTag(entityId);
        }
        return graph;
    };
}
