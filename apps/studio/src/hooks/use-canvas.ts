import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type Connection, type NodeChange, type EdgeChange, applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import { objectTypesApi } from '@/api/object-types';
import { propertiesApi } from '@/api/properties';
import { relationshipsApi } from '@/api/relationships';
import { useCanvasStore } from '@/stores/canvas-store';
import { useAppStore } from '@/stores/app-store';
import type {
  ObjectTypeCreate,
  PropertyCreate,
  RelationshipCreate,
  ObjectTypeNodeData,
  RelationshipEdgeData,
} from '@/types';
import type { Node, Edge } from '@xyflow/react';

export const objectTypesKey = (ontologyId: string) =>
  ['object-types', ontologyId] as const;

export const propertiesKey = (objectTypeId: string) =>
  ['properties', objectTypeId] as const;

export const relationshipsKey = (ontologyId: string) =>
  ['relationships', ontologyId] as const;

/** Load ontology canvas data (nodes + edges) from the API */
export function useCanvasData(ontologyId: string) {
  const { setNodes, setEdges } = useCanvasStore();

  const objectTypesQuery = useQuery({
    queryKey: objectTypesKey(ontologyId),
    queryFn: () => objectTypesApi.list(ontologyId),
    enabled: Boolean(ontologyId),
  });

  const relationshipsQuery = useQuery({
    queryKey: relationshipsKey(ontologyId),
    queryFn: () => relationshipsApi.list(ontologyId),
    enabled: Boolean(ontologyId),
  });

  // Hydrate canvas store once both queries resolve
  const hydrateCanvas = useCallback(async () => {
    if (!objectTypesQuery.data || !relationshipsQuery.data) return;

    const objectTypes = objectTypesQuery.data;

    // Fetch properties for each object type in parallel
    const propertiesByType = await Promise.all(
      objectTypes.map((ot) =>
        propertiesApi.list(ot.id).catch(() => []),
      ),
    );

    const nodes: Node<ObjectTypeNodeData>[] = objectTypes.map((ot, idx) => ({
      id: ot.id,
      type: 'objectTypeNode',
      position: { x: (idx % 4) * 280 + 60, y: Math.floor(idx / 4) * 220 + 60 },
      data: {
        objectType: ot,
        properties: propertiesByType[idx] ?? [],
        onSelect: () => useCanvasStore.getState().selectNode(ot.id),
      },
    }));

    const edges: Edge<RelationshipEdgeData>[] = relationshipsQuery.data.map((rel) => ({
      id: rel.id,
      type: 'relationshipEdge',
      source: rel.source_object_type_id,
      target: rel.target_object_type_id,
      data: { relationship: rel },
    }));

    setNodes(nodes);
    setEdges(edges);
  }, [objectTypesQuery.data, relationshipsQuery.data, setNodes, setEdges]);

  return {
    objectTypesQuery,
    relationshipsQuery,
    hydrateCanvas,
    isLoading: objectTypesQuery.isLoading || relationshipsQuery.isLoading,
    isError: objectTypesQuery.isError || relationshipsQuery.isError,
  };
}

export function useCreateObjectType(ontologyId: string) {
  const queryClient = useQueryClient();
  const { addNode } = useCanvasStore();
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: (payload: ObjectTypeCreate) => objectTypesApi.create(payload),
    onSuccess: (objectType) => {
      queryClient.invalidateQueries({ queryKey: objectTypesKey(ontologyId) });
      const existingCount = useCanvasStore.getState().nodes.length;
      const node: Node<ObjectTypeNodeData> = {
        id: objectType.id,
        type: 'objectTypeNode',
        position: {
          x: (existingCount % 4) * 280 + 60,
          y: Math.floor(existingCount / 4) * 220 + 60,
        },
        data: {
          objectType,
          properties: [],
          onSelect: () => useCanvasStore.getState().selectNode(objectType.id),
        },
      };
      addNode(node);
      addToast({
        type: 'success',
        title: 'Object type added',
        description: `"${objectType.display_name}" added to canvas.`,
      });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Failed to create object type' });
    },
  });
}

export function useCreateProperty(objectTypeId: string, ontologyId: string) {
  const queryClient = useQueryClient();
  const { updateNode } = useCanvasStore();
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: (payload: PropertyCreate) => propertiesApi.create(payload),
    onSuccess: (property) => {
      queryClient.invalidateQueries({ queryKey: propertiesKey(objectTypeId) });
      // Update the node data with the new property
      const node = useCanvasStore
        .getState()
        .nodes.find((n) => n.id === objectTypeId);
      if (node) {
        updateNode(objectTypeId, {
          properties: [...node.data.properties, property],
        });
      }
      addToast({ type: 'success', title: 'Property added' });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Failed to add property' });
    },
  });
}

export function useCreateRelationship(ontologyId: string) {
  const queryClient = useQueryClient();
  const { addEdge } = useCanvasStore();
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: (payload: RelationshipCreate) => relationshipsApi.create(payload),
    onSuccess: (relationship) => {
      queryClient.invalidateQueries({ queryKey: relationshipsKey(ontologyId) });
      const edge: Edge<RelationshipEdgeData> = {
        id: relationship.id,
        type: 'relationshipEdge',
        source: relationship.source_object_type_id,
        target: relationship.target_object_type_id,
        data: { relationship },
      };
      addEdge(edge);
      addToast({ type: 'success', title: 'Relationship created' });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Failed to create relationship' });
    },
  });
}

/** Stable handlers for React Flow onChange callbacks */
export function useFlowHandlers() {
  const { nodes, edges, setNodes, setEdges } = useCanvasStore();

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<ObjectTypeNodeData>>[]) => {
      setNodes(applyNodeChanges(changes, nodes));
    },
    [nodes, setNodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge<RelationshipEdgeData>>[]) => {
      setEdges(applyEdgeChanges(changes, edges));
    },
    [edges, setEdges],
  );

  return { onNodesChange, onEdgesChange };
}

/** Handle new connection from React Flow — prompts user to name the relationship */
export function useOnConnect(ontologyId: string) {
  const createRelationship = useCreateRelationship(ontologyId);

  return useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const apiName = prompt('Relationship API name (snake_case):');
      if (!apiName) return;
      createRelationship.mutate({
        ontology_id: ontologyId,
        api_name: apiName,
        source_object_type_id: connection.source,
        target_object_type_id: connection.target,
        cardinality: 'ONE_TO_MANY',
      });
    },
    [ontologyId, createRelationship],
  );
}
