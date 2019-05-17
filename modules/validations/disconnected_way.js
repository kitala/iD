import { t } from '../util/locale';
import { modeDrawLine } from '../modes/draw_line';
import { operationDelete } from '../operations/delete';
import { utilDisplayLabel } from '../util';
import { osmRoutableHighwayTagValues } from '../osm/tags';
import { validationIssue, validationIssueFix } from '../core/validation';


export function validationDisconnectedWay() {
    var type = 'disconnected_way';

    function isTaggedAsHighway(entity) {
        return osmRoutableHighwayTagValues[entity.tags.highway];
    }

    var validation = function checkDisconnectedWay(entity, context) {
        var graph = context.graph();

        if (!isTaggedAsHighway(entity)) return [];

        var routingIslandWays = routingIslandForWay(entity);
        if (!routingIslandWays) return [];

        var fixes = [];

        var isSingle = routingIslandWays.size === 1;

        if (isSingle) {

            if (entity.type === 'way' && !entity.isClosed()) {
                var firstID = entity.first();
                var lastID = entity.last();

                var first = context.entity(firstID);
                if (first.tags.noexit !== 'yes') {
                    fixes.push(new validationIssueFix({
                        icon: 'iD-operation-continue-left',
                        title: t('issues.fix.continue_from_start.title'),
                        entityIds: [firstID],
                        onClick: function() {
                            var wayId = this.issue.entityIds[0];
                            var way = context.entity(wayId);
                            var vertexId = this.entityIds[0];
                            var vertex = context.entity(vertexId);
                            continueDrawing(way, vertex, context);
                        }
                    }));
                }
                var last = context.entity(lastID);
                if (last.tags.noexit !== 'yes') {
                    fixes.push(new validationIssueFix({
                        icon: 'iD-operation-continue',
                        title: t('issues.fix.continue_from_end.title'),
                        entityIds: [lastID],
                        onClick: function() {
                            var wayId = this.issue.entityIds[0];
                            var way = context.entity(wayId);
                            var vertexId = this.entityIds[0];
                            var vertex = context.entity(vertexId);
                            continueDrawing(way, vertex, context);
                        }
                    }));
                }

            } else {
                fixes.push(new validationIssueFix({
                    title: t('issues.fix.connect_feature.title')
                }));
            }

            if (!operationDelete([entity.id], context).disabled()) {
                fixes.push(new validationIssueFix({
                    icon: 'iD-operation-delete',
                    title: t('issues.fix.delete_feature.title'),
                    entityIds: [entity.id],
                    onClick: function() {
                        var id = this.issue.entityIds[0];
                        var operation = operationDelete([id], context);
                        if (!operation.disabled()) {
                            operation();
                        }
                    }
                }));
            }
        } else {
            fixes.push(new validationIssueFix({
                title: t('issues.fix.connect_features.title')
            }));
        }

        return [new validationIssue({
            type: type,
            severity: 'warning',
            message: function() {
                if (this.entityIds.length === 1) {
                    var entity = context.hasEntity(this.entityIds[0]);
                    return entity ? t('issues.disconnected_way.highway.message', { highway: utilDisplayLabel(entity, context) }) : '';
                }
                return t('issues.disconnected_way.routable.message.multiple', { count: this.entityIds.length.toString() });
            },
            reference: showReference,
            entityIds: Array.from(routingIslandWays).map(function(way) { return way.id; }),
            fixes: fixes
        })];


        function showReference(selection) {
            selection.selectAll('.issue-reference')
                .data([0])
                .enter()
                .append('div')
                .attr('class', 'issue-reference')
                .text(t('issues.disconnected_way.routable.reference'));
        }


        function isConnectedVertex(vertex, way, relation, routingIslandSet) {
            // can not accurately test vertices on tiles not downloaded from osm - #5938
            var osm = context.connection();
            if (osm && !osm.isDataLoaded(vertex.loc)) return true;

            // entrances are considered connected
            if (vertex.tags.entrance &&
                vertex.tags.entrance !== 'no') return true;
            if (vertex.tags.amenity === 'parking_entrance') return true;

            var parentsWays = graph.parentWays(vertex);

            // standalone vertex
            if (parentsWays.length === 1) return false;

            var connectedWays = new Set();

            for (var i in parentsWays) {
                var parentWay = parentsWays[i];

                // ignore any way we've already accounted for
                if (routingIslandSet.has(parentWay)) continue;

                // count connections to ferry routes as connected
                if (parentWay.tags.route === 'ferry') return true;

                if (isTaggedAsHighway(parentWay)) connectedWays.add(parentWay);

                var parentRelations = graph.parentRelations(parentWay);

                for (var j in parentRelations) {
                    var parentRelation = parentRelations[j];

                    // ignore the relation we're testing, if any
                    if (relation && parentRelation === relation) continue;

                    if (parentRelation.tags.type === 'route' &&
                        parentRelation.tags.route === 'ferry') return true;

                    if (parentRelation.isMultipolygon() &&
                        isTaggedAsHighway(parentRelation)) return connectedWays.add(parentWay);
                }
            }

            if (connectedWays.size) return connectedWays;

            return false;
        }


        function routingIslandForWay(way, relation) {
            if (way.type !== 'way') return null;

            var waysToCheck = [way];
            var routingIsland = new Set([way]);

            while (waysToCheck.length) {
                var wayToCheck = waysToCheck.pop();
                var childNodes = graph.childNodes(wayToCheck);
                for (var i in childNodes) {
                    var vertex = childNodes[i];
                    var result = isConnectedVertex(vertex, entity, relation, routingIsland);
                    if (result === true) {
                        return null;
                    } else if (result === false) {
                        continue;
                    }
                    result.forEach(function(connectedWay) {
                        if (!routingIsland.has(connectedWay)) {
                            routingIsland.add(connectedWay);
                            waysToCheck.push(connectedWay);
                        }
                    });
                }
            }

            return routingIsland;
        }


        /*function isDisconnectedMultipolygon(entity) {
            if (entity.type !== 'relation' || !entity.isMultipolygon()) return false;

            return entity.members.every(function(member) {
                if (member.type !== 'way') return true;

                var way = graph.hasEntity(member.id);
                if (!way) return true;

                return isDisconnectedWay(way, entity);
            });
        }*/

        function continueDrawing(way, vertex) {
            // make sure the vertex is actually visible and editable
            var map = context.map();
            if (!map.editable() || !map.trimmedExtent().contains(vertex.loc)) {
                map.zoomToEase(vertex);
            }

            context.enter(
                modeDrawLine(context, way.id, context.graph(), context.graph(), 'line', way.affix(vertex.id), true)
            );
        }
    };


    validation.type = type;

    return validation;
}
