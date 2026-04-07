import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Folder,
  FolderOpen,
  BookOpen,
  ChevronRight,
  Plus,
  Home,
  LayoutGrid,
} from 'lucide-react';
import { gsap } from 'gsap';
import { useAppStore } from '@/stores/app-store';
import { useFolders } from '@/hooks/use-folders';
import { useOntologies } from '@/hooks/use-ontologies';
import { Sidebar as SidebarShell, SidebarSection, SidebarItem } from '@/components/ui/sidebar';
import type { FolderTreeNode } from '@/types';

interface FolderNodeProps {
  node: FolderTreeNode;
  indent?: number;
  spaceId: string;
  activeFolderId: string | null;
  activeOntologyId: string | null;
  onFolderClick: (id: string) => void;
  onOntologyClick: (spaceId: string, ontologyId: string) => void;
}

function buildTree(
  folders: import('@/types').Folder[],
  parentId: string | null,
  ontologiesByFolder: Map<string, import('@/types').Ontology[]>,
): FolderTreeNode[] {
  return folders
    .filter((f) => f.parent_folder_id === parentId)
    .map((f) => ({
      ...f,
      ontologies: ontologiesByFolder.get(f.id) ?? [],
      children: buildTree(folders, f.id, ontologiesByFolder),
    }));
}

function FolderNode({
  node,
  indent = 0,
  spaceId,
  activeFolderId,
  activeOntologyId,
  onFolderClick,
  onOntologyClick,
}: FolderNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<SVGSVGElement>(null);
  const hasChildren = node.children.length > 0 || node.ontologies.length > 0;

  const toggle = () => {
    if (!hasChildren) return;
    const content = contentRef.current;
    const chevron = chevronRef.current;
    if (!content || !chevron) return;

    if (!expanded) {
      gsap.fromTo(
        content,
        { height: 0, opacity: 0 },
        { height: 'auto', opacity: 1, duration: 0.2, ease: 'power2.out' },
      );
      gsap.to(chevron, { rotation: 90, duration: 0.2, ease: 'power2.out' });
    } else {
      gsap.to(content, {
        height: 0,
        opacity: 0,
        duration: 0.15,
        ease: 'power2.in',
      });
      gsap.to(chevron, { rotation: 0, duration: 0.15, ease: 'power2.in' });
    }
    setExpanded((v) => !v);
  };

  return (
    <div>
      <SidebarItem
        label={node.name}
        indent={indent}
        active={activeFolderId === node.id}
        icon={
          expanded ? (
            <FolderOpen className="h-4 w-4" />
          ) : (
            <Folder className="h-4 w-4" />
          )
        }
        suffix={
          hasChildren ? (
            <ChevronRight
              ref={chevronRef}
              className="h-3.5 w-3.5 text-gray-400 transition-none"
            />
          ) : undefined
        }
        onClick={() => {
          onFolderClick(node.id);
          toggle();
        }}
      />

      <div ref={contentRef} style={{ overflow: 'hidden', height: expanded ? 'auto' : 0 }}>
        {/* Ontologies under this folder */}
        {node.ontologies.map((ont) => (
          <SidebarItem
            key={ont.id}
            label={ont.name}
            indent={indent + 1}
            active={activeOntologyId === ont.id}
            icon={<BookOpen className="h-4 w-4" />}
            onClick={() => onOntologyClick(spaceId, ont.id)}
          />
        ))}

        {/* Child folders */}
        {node.children.map((child) => (
          <FolderNode
            key={child.id}
            node={child}
            indent={indent + 1}
            spaceId={spaceId}
            activeFolderId={activeFolderId}
            activeOntologyId={activeOntologyId}
            onFolderClick={onFolderClick}
            onOntologyClick={onOntologyClick}
          />
        ))}
      </div>
    </div>
  );
}

export default function AppSidebar() {
  const { sidebarOpen, currentFolderId, currentOntologyId, setCurrentFolder } =
    useAppStore();
  const navigate = useNavigate();
  const { spaceId } = useParams<{ spaceId: string }>();

  const foldersQuery = useFolders(spaceId ?? '');
  const ontologiesQuery = useOntologies(spaceId ?? '');

  const ontologiesByFolder = React.useMemo(() => {
    const map = new Map<string, import('@/types').Ontology[]>();
    (ontologiesQuery.data ?? []).forEach((ont) => {
      const arr = map.get(ont.folder_id) ?? [];
      arr.push(ont);
      map.set(ont.folder_id, arr);
    });
    return map;
  }, [ontologiesQuery.data]);

  const tree = React.useMemo(
    () => buildTree(foldersQuery.data ?? [], null, ontologiesByFolder),
    [foldersQuery.data, ontologiesByFolder],
  );

  const handleOntologyClick = (sid: string, ontologyId: string) => {
    navigate(`/spaces/${sid}/ontology/${ontologyId}`);
  };

  return (
    <SidebarShell open={sidebarOpen}>
      {/* Nav links */}
      <div className="px-2 pt-3 pb-1 border-b border-gray-100">
        <SidebarItem
          label="Home"
          icon={<Home className="h-4 w-4" />}
          onClick={() => navigate('/')}
        />
        <SidebarItem
          label="All Spaces"
          icon={<LayoutGrid className="h-4 w-4" />}
          onClick={() => navigate('/spaces')}
        />
      </div>

      {/* Folder tree — only shown when inside a space */}
      {spaceId && (
        <SidebarSection
          title="Folders"
          action={
            <button
              className="p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="New folder"
              onClick={() => {/* handled by SpacePage */}}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          }
        >
          {foldersQuery.isLoading && (
            <p className="px-3 text-xs text-gray-400 py-2">Loading…</p>
          )}
          {tree.map((node) => (
            <FolderNode
              key={node.id}
              node={node}
              spaceId={spaceId}
              activeFolderId={currentFolderId}
              activeOntologyId={currentOntologyId}
              onFolderClick={setCurrentFolder}
              onOntologyClick={handleOntologyClick}
            />
          ))}
          {!foldersQuery.isLoading && tree.length === 0 && (
            <p className="px-3 text-xs text-gray-400 py-2">No folders yet</p>
          )}
        </SidebarSection>
      )}
    </SidebarShell>
  );
}
