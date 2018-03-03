export function actionAddNegEntities(negEntities) {
    return function(graph) {
        return graph.addNegEntities(negEntities);
    };
}
