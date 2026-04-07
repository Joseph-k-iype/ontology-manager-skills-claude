import apiClient from './client';
import type { Ontology, OntologyCreate } from '@/types';

export const ontologiesApi = {
  list: async (spaceId: string, folderId?: string): Promise<Ontology[]> => {
    const params = folderId ? { folder_id: folderId } : {};
    const { data } = await apiClient.get<Ontology[]>(
      `/api/v1/spaces/${spaceId}/ontologies`,
      { params },
    );
    return data;
  },

  get: async (spaceId: string, ontologyId: string): Promise<Ontology> => {
    const { data } = await apiClient.get<Ontology>(
      `/api/v1/spaces/${spaceId}/ontologies/${ontologyId}`,
    );
    return data;
  },

  create: async (payload: OntologyCreate): Promise<Ontology> => {
    const { data } = await apiClient.post<Ontology>(
      `/api/v1/spaces/${payload.space_id}/ontologies`,
      payload,
    );
    return data;
  },

  update: async (
    spaceId: string,
    ontologyId: string,
    payload: Partial<Pick<OntologyCreate, 'name' | 'description'>>,
  ): Promise<Ontology> => {
    const { data } = await apiClient.patch<Ontology>(
      `/api/v1/spaces/${spaceId}/ontologies/${ontologyId}`,
      payload,
    );
    return data;
  },

  publish: async (spaceId: string, ontologyId: string): Promise<Ontology> => {
    const { data } = await apiClient.post<Ontology>(
      `/api/v1/spaces/${spaceId}/ontologies/${ontologyId}/publish`,
    );
    return data;
  },

  export: async (spaceId: string, ontologyId: string): Promise<Blob> => {
    const { data } = await apiClient.get<Blob>(
      `/api/v1/spaces/${spaceId}/ontologies/${ontologyId}/export`,
      { responseType: 'blob' },
    );
    return data;
  },

  delete: async (spaceId: string, ontologyId: string): Promise<void> => {
    await apiClient.delete(
      `/api/v1/spaces/${spaceId}/ontologies/${ontologyId}`,
    );
  },
};
