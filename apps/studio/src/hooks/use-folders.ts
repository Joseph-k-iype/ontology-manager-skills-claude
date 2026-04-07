import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { foldersApi } from '@/api/folders';
import { useAppStore } from '@/stores/app-store';
import type { Folder, FolderCreate, FolderTreeNode } from '@/types';

export const foldersKey = (spaceId: string) => ['folders', spaceId] as const;

/** Build a recursive tree from a flat folder list */
function buildTree(
  folders: Folder[],
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

export function useFolders(spaceId: string) {
  return useQuery({
    queryKey: foldersKey(spaceId),
    queryFn: () => foldersApi.list(spaceId),
    enabled: Boolean(spaceId),
  });
}

export function useFolderTree(
  spaceId: string,
  ontologiesByFolder: Map<string, import('@/types').Ontology[]> = new Map(),
) {
  const query = useFolders(spaceId);
  const tree = query.data
    ? buildTree(query.data, null, ontologiesByFolder)
    : [];
  return { ...query, tree };
}

export function useCreateFolder(spaceId: string) {
  const queryClient = useQueryClient();
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: (payload: FolderCreate) => foldersApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: foldersKey(spaceId) });
      addToast({ type: 'success', title: 'Folder created' });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Failed to create folder' });
    },
  });
}

export function useDeleteFolder(spaceId: string) {
  const queryClient = useQueryClient();
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: (folderId: string) => foldersApi.delete(spaceId, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: foldersKey(spaceId) });
      addToast({ type: 'success', title: 'Folder deleted' });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Failed to delete folder' });
    },
  });
}
