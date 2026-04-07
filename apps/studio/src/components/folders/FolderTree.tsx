import React, { useState, useRef } from 'react';
import { Folder, FolderOpen, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { gsap } from 'gsap';
import { clsx } from 'clsx';
import { useAppStore } from '@/stores/app-store';
import { useFolders, useDeleteFolder } from '@/hooks/use-folders';
import type { Folder as FolderType, FolderTreeNode, Ontology } from '@/types';

function buildTree(
  folders: FolderType[],
  parentId: string | null,
  ontologiesByFolder: Map<string, Ontology[]>,
): FolderTreeNode[] {
  return folders
    .filter((f) => f.parent_folder_id === parentId)
    .map((f) => ({
      ...f,
      ontologies: ontologiesByFolder.get(f.id) ?? [],
      children: buildTree(folders, f.id, ontologiesByFolder),
    }));
}

interface FolderRowProps {
  node: FolderTreeNode;
  depth: number;
  spaceId: string;
  activeFolderId: string | null;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
}

function FolderRow({
  node,
  depth,
  spaceId,
  activeFolderId,
  onSelect,
  onCreateChild,
}: FolderRowProps) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<SVGSVGElement>(null);
  const deleteFolder = useDeleteFolder(spaceId);

  const hasChildren = node.children.length > 0;

  const toggle = () => {
    if (!hasChildren) return;
    const el = contentRef.current;
    const chev = chevronRef.current;
    if (!el || !chev) return;

    if (!expanded) {
      gsap.fromTo(el, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.18, ease: 'power2.out' });
      gsap.to(chev, { rotation: 90, duration: 0.18 });
    } else {
      gsap.to(el, { height: 0, opacity: 0, duration: 0.12, ease: 'power2.in' });
      gsap.to(chev, { rotation: 0, duration: 0.12 });
    }
    setExpanded((v) => !v);
  };

  return (
    <div>
      <div
        className={clsx(
          'group flex items-center gap-1.5 rounded-md py-1.5 pr-2 text-sm cursor-pointer transition-colors select-none',
          activeFolderId === node.id
            ? 'bg-primary-50 text-primary-700 font-medium'
            : 'text-gray-700 hover:bg-gray-50',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          onSelect(node.id);
          toggle();
        }}
      >
        <ChevronRight
          ref={chevronRef}
          className={clsx(
            'h-3.5 w-3.5 shrink-0 text-gray-400 transition-none',
            !hasChildren && 'invisible',
          )}
        />
        {expanded ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-primary-500" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-gray-400" />
        )}
        <span className="flex-1 truncate">{node.name}</span>

        {/* Hover actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onCreateChild(node.id); }}
            className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200"
            title="New child folder"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete folder "${node.name}"?`)) {
                deleteFolder.mutate(node.id);
              }
            }}
            className="p-0.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
            title="Delete folder"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div ref={contentRef} style={{ overflow: 'hidden', height: expanded ? 'auto' : 0 }}>
        {node.children.map((child) => (
          <FolderRow
            key={child.id}
            node={child}
            depth={depth + 1}
            spaceId={spaceId}
            activeFolderId={activeFolderId}
            onSelect={onSelect}
            onCreateChild={onCreateChild}
          />
        ))}
      </div>
    </div>
  );
}

interface FolderTreeProps {
  spaceId: string;
  ontologiesByFolder?: Map<string, Ontology[]>;
  onCreateFolder: (parentId?: string) => void;
}

export default function FolderTree({
  spaceId,
  ontologiesByFolder = new Map(),
  onCreateFolder,
}: FolderTreeProps) {
  const { currentFolderId, setCurrentFolder } = useAppStore();
  const foldersQuery = useFolders(spaceId);
  const tree = React.useMemo(
    () => buildTree(foldersQuery.data ?? [], null, ontologiesByFolder),
    [foldersQuery.data, ontologiesByFolder],
  );

  const handleCreateChild = (parentId: string) => {
    onCreateFolder(parentId);
  };

  if (foldersQuery.isLoading) {
    return <p className="text-sm text-gray-400 px-2 py-3">Loading folders…</p>;
  }

  if (tree.length === 0) {
    return (
      <div className="text-center py-6 px-4">
        <p className="text-sm text-gray-400">No folders yet.</p>
        <button
          onClick={() => onCreateFolder()}
          className="mt-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          Create first folder
        </button>
      </div>
    );
  }

  return (
    <div className="py-1">
      {tree.map((node) => (
        <FolderRow
          key={node.id}
          node={node}
          depth={0}
          spaceId={spaceId}
          activeFolderId={currentFolderId}
          onSelect={setCurrentFolder}
          onCreateChild={handleCreateChild}
        />
      ))}
    </div>
  );
}
