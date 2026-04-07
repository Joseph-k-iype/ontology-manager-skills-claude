import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus,
  BookOpen,
  Folder,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VisibilityBadge } from '@/components/ui/badge';
import FolderTree from '@/components/folders/FolderTree';
import OntologyList from '@/components/ontologies/OntologyList';
import CreateFolderModal from '@/components/folders/CreateFolderModal';
import CreateOntologyModal from '@/components/ontologies/CreateOntologyModal';
import { useSpace } from '@/hooks/use-spaces';
import { useOntologies } from '@/hooks/use-ontologies';
import { useAppStore } from '@/stores/app-store';
import { useQueryClient } from '@tanstack/react-query';
import { foldersKey } from '@/hooks/use-folders';
import { ontologiesKey } from '@/hooks/use-ontologies';
import type { Ontology } from '@/types';

export default function SpacePage() {
  const { spaceId = '' } = useParams<{ spaceId: string }>();
  const navigate = useNavigate();
  const { currentFolderId, setCurrentFolder } = useAppStore();
  const queryClient = useQueryClient();

  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [createFolderParent, setCreateFolderParent] = useState<string | undefined>();
  const [showCreateOntology, setShowCreateOntology] = useState(false);

  const spaceQuery = useSpace(spaceId);
  const ontologiesQuery = useOntologies(spaceId);

  // Build ontologiesByFolder map for FolderTree rendering
  const ontologiesByFolder = useMemo(() => {
    const map = new Map<string, Ontology[]>();
    (ontologiesQuery.data ?? []).forEach((ont) => {
      const arr = map.get(ont.folder_id) ?? [];
      arr.push(ont);
      map.set(ont.folder_id, arr);
    });
    return map;
  }, [ontologiesQuery.data]);

  // Ontologies in the currently selected folder
  const filteredOntologies = useMemo(() => {
    if (!currentFolderId) return ontologiesQuery.data ?? [];
    return (ontologiesQuery.data ?? []).filter(
      (ont) => ont.folder_id === currentFolderId,
    );
  }, [ontologiesQuery.data, currentFolderId]);

  const handleCreateFolder = (parentId?: string) => {
    setCreateFolderParent(parentId);
    setShowCreateFolder(true);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: foldersKey(spaceId) });
    queryClient.invalidateQueries({ queryKey: ontologiesKey(spaceId) });
  };

  if (spaceQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  if (spaceQuery.isError || !spaceQuery.data) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-3">
        <p className="text-gray-500">Space not found.</p>
        <Button variant="secondary" size="sm" onClick={() => navigate('/spaces')}>
          Back to Spaces
        </Button>
      </div>
    );
  }

  const space = spaceQuery.data;

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex h-full"
    >
      {/* Left panel: folder tree */}
      <aside className="w-64 border-r border-gray-200 bg-white flex flex-col shrink-0 overflow-hidden">
        {/* Space header */}
        <div className="px-4 py-4 border-b border-gray-100">
          <button
            onClick={() => navigate('/spaces')}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mb-3 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Spaces
          </button>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900 truncate text-sm">
                {space.name}
              </h2>
              {space.description && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {space.description}
                </p>
              )}
            </div>
            <VisibilityBadge visibility={space.visibility} />
          </div>
        </div>

        {/* Folder tree */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1">
              <Folder className="h-3.5 w-3.5" />
              Folders
            </span>
            <button
              onClick={() => handleCreateFolder()}
              className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title="New folder"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <FolderTree
            spaceId={spaceId}
            ontologiesByFolder={ontologiesByFolder}
            onCreateFolder={handleCreateFolder}
          />
        </div>
      </aside>

      {/* Main content: ontology list */}
      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {/* Toolbar */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary-600" />
                {currentFolderId ? 'Folder Ontologies' : 'All Ontologies'}
              </h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {filteredOntologies.length} ontolog
                {filteredOntologies.length !== 1 ? 'ies' : 'y'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw className="h-4 w-4" />}
                onClick={handleRefresh}
                title="Refresh"
              />
              <Button
                size="sm"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => setShowCreateOntology(true)}
                disabled={!currentFolderId}
                title={!currentFolderId ? 'Select a folder first' : 'New ontology'}
              >
                New Ontology
              </Button>
            </div>
          </div>

          {!currentFolderId && (
            <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              Select a folder in the left panel to create or filter ontologies.
            </div>
          )}

          {ontologiesQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 bg-white rounded-xl border border-gray-200 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <OntologyList ontologies={filteredOntologies} spaceId={spaceId} />
          )}
        </div>
      </main>

      {/* Modals */}
      <CreateFolderModal
        open={showCreateFolder}
        onClose={() => { setShowCreateFolder(false); setCreateFolderParent(undefined); }}
        spaceId={spaceId}
        parentFolderId={createFolderParent ?? null}
      />

      {currentFolderId && (
        <CreateOntologyModal
          open={showCreateOntology}
          onClose={() => setShowCreateOntology(false)}
          spaceId={spaceId}
          folderId={currentFolderId}
        />
      )}
    </motion.div>
  );
}
