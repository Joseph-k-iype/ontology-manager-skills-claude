import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { spacesApi } from '@/api/spaces';
import { useAppStore } from '@/stores/app-store';
import type { SpaceCreate } from '@/types';

export const SPACES_KEY = ['spaces'] as const;
export const spaceKey = (id: string) => ['spaces', id] as const;

export function useSpaces() {
  return useQuery({
    queryKey: SPACES_KEY,
    queryFn: spacesApi.list,
  });
}

export function useSpace(id: string) {
  return useQuery({
    queryKey: spaceKey(id),
    queryFn: () => spacesApi.get(id),
    enabled: Boolean(id),
  });
}

export function useCreateSpace() {
  const queryClient = useQueryClient();
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: (payload: SpaceCreate) => spacesApi.create(payload),
    onSuccess: (space) => {
      queryClient.invalidateQueries({ queryKey: SPACES_KEY });
      addToast({
        type: 'success',
        title: 'Space created',
        description: `"${space.name}" is ready.`,
      });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Failed to create space' });
    },
  });
}

export function useUpdateSpace(id: string) {
  const queryClient = useQueryClient();
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: (payload: Partial<SpaceCreate>) => spacesApi.update(id, payload),
    onSuccess: (space) => {
      queryClient.invalidateQueries({ queryKey: SPACES_KEY });
      queryClient.invalidateQueries({ queryKey: spaceKey(id) });
      addToast({
        type: 'success',
        title: 'Space updated',
        description: `"${space.name}" saved.`,
      });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Failed to update space' });
    },
  });
}

export function useDeleteSpace() {
  const queryClient = useQueryClient();
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: (id: string) => spacesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SPACES_KEY });
      addToast({ type: 'success', title: 'Space deleted' });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Failed to delete space' });
    },
  });
}
