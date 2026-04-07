import React, { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import type { RelationshipEdgeData } from '@/types';

const CARDINALITY_LABEL: Record<string, string> = {
  ONE_TO_ONE: '1:1',
  ONE_TO_MANY: '1:N',
  MANY_TO_MANY: 'N:M',
};

interface RelationshipEdgeProps extends EdgeProps {
  data: RelationshipEdgeData;
}

function RelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: RelationshipEdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const cardinality = data?.relationship?.cardinality ?? 'ONE_TO_MANY';
  const apiName = data?.relationship?.api_name ?? '';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#6366f1' : '#4b5563',
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: cardinality === 'MANY_TO_MANY' ? '6 3' : undefined,
        }}
        markerEnd={`url(#arrow-${id})`}
      />

      {/* Custom arrowhead */}
      <defs>
        <marker
          id={`arrow-${id}`}
          markerWidth="8"
          markerHeight="8"
          refX="8"
          refY="4"
          orient="auto"
        >
          <path
            d="M0,0 L0,8 L8,4 z"
            fill={selected ? '#6366f1' : '#6b7280'}
          />
        </marker>
      </defs>

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'none',
          }}
          className="nodrag nopan"
        >
          <div className="flex flex-col items-center gap-0.5">
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-canvas-grid text-gray-300 border border-canvas-nodeBorder shadow-sm whitespace-nowrap"
              style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {apiName}
            </span>
            <span className="text-[9px] font-mono text-gray-500">
              {CARDINALITY_LABEL[cardinality]}
            </span>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(RelationshipEdge);
