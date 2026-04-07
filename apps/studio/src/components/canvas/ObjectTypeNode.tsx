import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Key, Hash } from 'lucide-react';
import { clsx } from 'clsx';
import { Badge } from '@/components/ui/badge';
import type { ObjectTypeNodeData, PropertyDataType } from '@/types';

const DATA_TYPE_COLORS: Record<PropertyDataType, string> = {
  string: 'text-sky-400',
  integer: 'text-violet-400',
  float: 'text-violet-400',
  boolean: 'text-amber-400',
  date: 'text-rose-400',
  datetime: 'text-rose-400',
  uri: 'text-emerald-400',
};

const DATA_TYPE_ABBREV: Record<PropertyDataType, string> = {
  string: 'str',
  integer: 'int',
  float: 'float',
  boolean: 'bool',
  date: 'date',
  datetime: 'dt',
  uri: 'uri',
};

interface ObjectTypeNodeProps extends NodeProps {
  data: ObjectTypeNodeData;
  selected: boolean;
}

function ObjectTypeNode({ data, selected }: ObjectTypeNodeProps) {
  const { objectType, properties } = data;
  const visibleProps = properties.slice(0, 6);
  const overflow = properties.length - visibleProps.length;

  return (
    <div
      onClick={() => data.onSelect(objectType.id)}
      className={clsx(
        'rounded-xl min-w-[220px] max-w-[280px] font-sans text-left',
        'border bg-canvas-node transition-all duration-150',
        selected
          ? 'border-primary-500 shadow-node-selected'
          : 'border-canvas-nodeBorder shadow-node hover:border-primary-400',
      )}
      style={{ cursor: 'pointer' }}
    >
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-canvas-nodeBorder">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="text-white font-semibold text-sm leading-tight truncate">
            {objectType.display_name}
          </span>
          <div className="flex gap-1 shrink-0">
            {objectType.is_skos_concept && (
              <Badge variant="purple" className="text-[10px] px-1.5 py-0">SKOS</Badge>
            )}
          </div>
        </div>
        <span className="text-[11px] font-mono text-gray-500">{objectType.api_name}</span>
      </div>

      {/* Properties list */}
      <div className="px-3 py-2 flex flex-col gap-1">
        {visibleProps.map((prop) => (
          <div key={prop.id} className="flex items-center gap-1.5 text-xs">
            {prop.api_name === objectType.primary_key ? (
              <Key className="h-3 w-3 text-amber-400 shrink-0" />
            ) : (
              <Hash className="h-3 w-3 text-gray-600 shrink-0" />
            )}
            <span
              className={clsx(
                'truncate flex-1',
                prop.api_name === objectType.primary_key
                  ? 'text-amber-300 font-medium'
                  : 'text-gray-300',
              )}
            >
              {prop.api_name}
            </span>
            <span
              className={clsx(
                'font-mono text-[10px] shrink-0',
                DATA_TYPE_COLORS[prop.data_type],
              )}
            >
              {DATA_TYPE_ABBREV[prop.data_type]}
              {prop.required ? '' : '?'}
            </span>
          </div>
        ))}

        {overflow > 0 && (
          <p className="text-[10px] text-gray-600 mt-0.5">+{overflow} more properties</p>
        )}

        {properties.length === 0 && (
          <p className="text-[11px] text-gray-600 italic">No properties</p>
        )}
      </div>

      {/* Footer — property count */}
      <div className="px-3 py-1.5 border-t border-canvas-nodeBorder">
        <span className="text-[10px] text-gray-600">
          {properties.length} {properties.length === 1 ? 'property' : 'properties'}
        </span>
      </div>

      {/* React Flow handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-primary-500 !border-canvas-bg !w-3 !h-3"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-primary-500 !border-canvas-bg !w-3 !h-3"
      />
    </div>
  );
}

export default memo(ObjectTypeNode);
