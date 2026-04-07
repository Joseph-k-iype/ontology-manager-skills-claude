/**
 * ExploreView — AntV G6 read-only graph exploration.
 *
 * This file is ONLY imported via React.lazy() in App.tsx and ExplorePage.tsx.
 * It must never be statically imported in any file that loads with the main bundle.
 */
import React, { useEffect, useRef } from 'react';
import type { Ontology, ObjectType, Relationship } from '@/types';

interface ExploreViewProps {
  ontology: Ontology;
  objectTypes: ObjectType[];
  relationships: Relationship[];
}

/**
 * Dynamically import G6 at runtime so it is never pulled into the initial chunk.
 * We use a module-level promise so subsequent renders do not re-import.
 */
let g6Promise: Promise<typeof import('@antv/g6')> | null = null;
function loadG6() {
  if (!g6Promise) {
    g6Promise = import('@antv/g6');
  }
  return g6Promise;
}

export default function ExploreView({
  ontology,
  objectTypes,
  relationships,
}: ExploreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<import('@antv/g6').Graph | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const G6 = await loadG6();
      if (cancelled || !containerRef.current) return;

      // Destroy any existing graph
      if (graphRef.current) {
        graphRef.current.destroy();
        graphRef.current = null;
      }

      const nodes = objectTypes.map((ot) => ({
        id: ot.id,
        data: {
          label: ot.display_name,
          apiName: ot.api_name,
          isSkos: ot.is_skos_concept,
        },
      }));

      const edges = relationships.map((rel) => ({
        id: rel.id,
        source: rel.source_object_type_id,
        target: rel.target_object_type_id,
        data: { label: rel.api_name },
      }));

      const graph = new G6.Graph({
        container: containerRef.current,
        width: containerRef.current.offsetWidth,
        height: containerRef.current.offsetHeight,
        data: { nodes, edges },
        layout: {
          type: 'force',
          preventOverlap: true,
          nodeSpacing: 60,
        },
        node: {
          style: {
            fill: '#1a1d2e',
            stroke: '#4f46e5',
            lineWidth: 2,
            radius: 8,
            labelText: (d: { data: { label: string } }) => d.data.label,
            labelFill: '#e5e7eb',
            labelFontSize: 13,
            labelFontFamily: 'Inter, system-ui, sans-serif',
            labelPlacement: 'bottom',
          },
        },
        edge: {
          style: {
            stroke: '#4b5563',
            lineWidth: 1.5,
            endArrow: true,
            labelText: (d: { data: { label: string } }) => d.data.label,
            labelFill: '#9ca3af',
            labelFontSize: 10,
            labelBackground: true,
            labelBackgroundFill: '#0f1117',
          },
        },
        behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element', 'click-select'],
      });

      await graph.render();
      graphRef.current = graph;
    }

    init();

    return () => {
      cancelled = true;
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [objectTypes, relationships]);

  // Handle resize
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (graphRef.current && containerRef.current) {
        graphRef.current.resize(
          containerRef.current.offsetWidth,
          containerRef.current.offsetHeight,
        );
      }
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="h-full w-full bg-canvas-bg relative">
      <div ref={containerRef} className="h-full w-full" />

      {/* Overlay: ontology label */}
      <div className="absolute top-4 left-4 bg-canvas-node border border-canvas-nodeBorder rounded-lg px-3 py-2 text-sm text-gray-300 shadow">
        <span className="font-semibold text-white">{ontology.name}</span>
        <span className="ml-2 text-gray-500 text-xs font-mono">v{ontology.version}</span>
      </div>
    </div>
  );
}
