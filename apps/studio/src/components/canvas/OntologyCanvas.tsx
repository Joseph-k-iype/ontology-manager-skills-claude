import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCanvasStore } from '@/stores/canvas-store';
import {
  useCanvasData,
  useFlowHandlers,
  useOnConnect,
} from '@/hooks/use-canvas';
import ObjectTypeNode from './ObjectTypeNode';
import RelationshipEdge from './RelationshipEdge';

const nodeTypes: NodeTypes = {
  objectTypeNode: ObjectTypeNode as never,
};

const edgeTypes: EdgeTypes = {
  relationshipEdge: RelationshipEdge as never,
};

interface OntologyCanvasProps {
  ontologyId: string;
  onNodeSelect?: (nodeId: string | null) => void;
}

export default function OntologyCanvas({
  ontologyId,
  onNodeSelect,
}: OntologyCanvasProps) {
  const { nodes, edges, selectNode } = useCanvasStore();
  const { hydrateCanvas, isLoading } = useCanvasData(ontologyId);
  const { onNodesChange, onEdgesChange } = useFlowHandlers();
  const onConnect = useOnConnect(ontologyId);

  // Load data once ontologyId is available
  useEffect(() => {
    if (ontologyId) {
      hydrateCanvas();
    }
  }, [ontologyId, hydrateCanvas]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id);
      onNodeSelect?.(node.id);
    },
    [selectNode, onNodeSelect],
  );

  const handlePaneClick = useCallback(() => {
    selectNode(null);
    onNodeSelect?.(null);
  }, [selectNode, onNodeSelect]);

  const defaultViewport = useMemo(() => ({ x: 0, y: 0, zoom: 0.85 }), []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          <span className="text-sm text-gray-400">Loading canvas…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-canvas-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        defaultViewport={defaultViewport}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode="Delete"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#1e2130"
        />
        <Controls
          className="!bg-canvas-node !border-canvas-nodeBorder"
          showInteractive={false}
        />
        <MiniMap
          className="!bg-canvas-node !border-canvas-nodeBorder"
          nodeColor="#1a1d2e"
          maskColor="rgba(0,0,0,0.5)"
        />
      </ReactFlow>
    </div>
  );
}
