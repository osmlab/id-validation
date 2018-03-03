export function actionAddEntity(ent) {
    return function(graph) {
        return graph.replace(ent);
    };
}
