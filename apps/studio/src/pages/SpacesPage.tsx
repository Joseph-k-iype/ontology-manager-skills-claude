import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, LayoutGrid, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SpaceList from '@/components/spaces/SpaceList';
import CreateSpaceModal from '@/components/spaces/CreateSpaceModal';
import { useSpaces } from '@/hooks/use-spaces';
import { useQueryClient } from '@tanstack/react-query';
import { SPACES_KEY } from '@/hooks/use-spaces';

export default function SpacesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const { data: spaces, isLoading, isError } = useSpaces();
  const queryClient = useQueryClient();

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="max-w-7xl mx-auto px-6 py-8"
    >
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <LayoutGrid className="h-6 w-6 text-primary-600" />
            Spaces
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Top-level containers for your ontologies
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => queryClient.invalidateQueries({ queryKey: SPACES_KEY })}
            title="Refresh"
          />
          <Button
            size="sm"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setShowCreate(true)}
          >
            New Space
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-40 bg-white rounded-xl border border-gray-200 animate-pulse"
            />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-gray-500">Failed to load spaces.</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: SPACES_KEY })}
          >
            Try again
          </Button>
        </div>
      )}

      {!isLoading && !isError && <SpaceList spaces={spaces ?? []} />}

      <CreateSpaceModal open={showCreate} onClose={() => setShowCreate(false)} />
    </motion.div>
  );
}
