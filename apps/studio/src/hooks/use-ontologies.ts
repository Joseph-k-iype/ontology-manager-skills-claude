import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ontologiesApi } from '@/api/ontologies';
import { useAppStore } from '@/stores/app-store';
import type { OntologyCreate } from '@/types';

export const ontologiesKey = (spaceId: string, folderId?: string) =>
  folderId ? ['ontologies', spaceId, folderId] : ['ontologies', spaceId];

export const ontologyKey = (spaceId: string, ontologyId: string) =>
  ['ontologies', spaceId, 'detail', ontologyId] as const;

export function useOntologies(spaceId: string, folderId?: string) {
  return useQuery({
    queryKey: ontologiesKey(spaceId, folderId),
    queryFn: () => ontologiesApi.list(spaceId, folderId),
    enabled: Boolean(spaceId),
  });
}

export function useOntology(spaceId: string, ontologyId: string) {
  return useQuery({
    queryKey: ontologyKey(spaceId, ontologyId),
    queryFn: () => ontologiesApi.get(spaceId, ontologyId),
    enabled: Boolean(spaceId) && Boolean(ontologyId),
  });
}

export function useCreateOntology(spaceId: string) {
  const queryClient = useQueryClient();
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: (payload: OntologyCreate) => ontologiesApi.create(payload),
    onSuccess: (ontology) => {
      queryClient.invalidateQueries({ queryKey: ontologiesKey(spaceId) });
      addToast({
        type: 'success',
        title: 'Ontology created',
        description: `"${ontology.name}" is ready.`,
      });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Failed to create ontology' });
    },
  });
}

export function usePublishOntology(spaceId: string, ontologyId: string) {
  const queryClient = useQueryClient();
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: () => ontologiesApi.publish(spaceId, ontologyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ontologyKey(spaceId, ontologyId) });
      queryClient.invalidateQueries({ queryKey: ontologiesKey(spaceId) });
      addToast({ type: 'success', title: 'Ontology published' });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Failed to publish ontology' });
    },
  });
}

export function useExportOntology(spaceId: string, ontologyId: string) {
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: () => ontologiesApi.export(spaceId, ontologyId),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ontology-${ontologyId}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
      addToast({ type: 'success', title: 'Export downloaded' });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Export failed' });
    },
  });
}

export function useDeleteOntology(spaceId: string) {
  const queryClient = useQueryClient();
  const addToast = useAppStore((s) => s.addToast);

  return useMutation({
    mutationFn: (ontologyId: string) => ontologiesApi.delete(spaceId, ontologyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ontologiesKey(spaceId) });
      addToast({ type: 'success', title: 'Ontology deleted' });
    },
    onError: () => {
      addToast({ type: 'error', title: 'Failed to delete ontology' });
    },
  });
}
