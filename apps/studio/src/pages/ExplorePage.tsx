/**
 * ExplorePage — AntV G6 graph exploration.
 *
 * This module is ONLY imported via React.lazy() in App.tsx.
 * It must never be statically imported from any eagerly-loaded file.
 */
import React, { Suspense, lazy } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, LayoutGrid } from 'lucide-react';
import { useOntology } from '@/hooks/use-ontologies';
import { useQuery } from '@tanstack/react-query';
import { objectTypesApi } from '@/api/object-types';
import { relationshipsApi } from '@/api/relationships';
import { StatusBadge } from '@/components/ui/badge';

// Lazy-load ExploreView so G6 is never in the main bundle
const ExploreView = lazy(() => import('@/components/canvas/ExploreView'));

export default function ExplorePage() {
  const { spaceId = '', ontologyId = '' } = useParams<{
    spaceId: string;
    ontologyId: string;
  }>();
  const navigate = useNavigate();

  const ontologyQuery = useOntology(spaceId, ontologyId);

  const objectTypesQuery = useQuery({
    queryKey: ['object-types', ontologyId],
    queryFn: () => objectTypesApi.list(ontologyId),
    enabled: Boolean(ontologyId),
  });

  const relationshipsQuery = useQuery({
    queryKey: ['relationships', ontologyId],
    queryFn: () => relationshipsApi.list(ontologyId),
    enabled: Boolean(ontologyId),
  });

  const isLoading =
    ontologyQuery.isLoading ||
    objectTypesQuery.isLoading ||
    relationshipsQuery.isLoading;

  return (
    <div className="flex flex-col h-screen bg-canvas-bg">
      {/* Toolbar */}
      <header className="h-12 bg-canvas-node border-b border-canvas-nodeBorder flex items-center px-4 gap-3 shrink-0 z-10">
        <Link
          to={`/spaces/${spaceId}/ontology/${ontologyId}`}
          className="flex items-center gap-1.5 text-gray-400 hover:text-gray-200 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Canvas
        </Link>

        <div className="h-4 w-px bg-canvas-nodeBorder" />

        {ontologyQuery.data && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-white font-medium">{ontologyQuery.data.name}</span>
            <span className="text-gray-600 font-mono text-xs">
              v{ontologyQuery.data.version}
            </span>
            <StatusBadge status={ontologyQuery.data.status} />
          </div>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-2 text-xs text-gray-500">
          {objectTypesQuery.data && (
            <span className="flex items-center gap-1">
              <LayoutGrid className="h-3.5 w-3.5" />
              {objectTypesQuery.data.length} types
            </span>
          )}
        </div>
      </header>

      {/* G6 canvas */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
              <span className="text-sm text-gray-400">Loading graph data…</span>
            </div>
          </div>
        ) : ontologyQuery.data &&
          objectTypesQuery.data &&
          relationshipsQuery.data ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
              </div>
            }
          >
            <ExploreView
              ontology={ontologyQuery.data}
              objectTypes={objectTypesQuery.data}
              relationships={relationshipsQuery.data}
            />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-gray-500">Failed to load graph data.</p>
          </div>
        )}
      </div>
    </div>
  );
}
