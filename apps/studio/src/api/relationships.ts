import apiClient from './client';
import type { Relationship, RelationshipCreate } from '@/types';

export const relationshipsApi = {
  list: async (ontologyId: string): Promise<Relationship[]> => {
    const { data } = await apiClient.get<Relationship[]>(
      `/api/v1/ontologies/${ontologyId}/relationships`,
    );
    return data;
  },

  get: async (ontologyId: string, relationshipId: string): Promise<Relationship> => {
    const { data } = await apiClient.get<Relationship>(
      `/api/v1/ontologies/${ontologyId}/relationships/${relationshipId}`,
    );
    return data;
  },

  create: async (payload: RelationshipCreate): Promise<Relationship> => {
    const { data } = await apiClient.post<Relationship>(
      `/api/v1/ontologies/${payload.ontology_id}/relationships`,
      payload,
    );
    return data;
  },

  update: async (
    ontologyId: string,
    relationshipId: string,
    payload: Partial<Omit<RelationshipCreate, 'ontology_id'>>,
  ): Promise<Relationship> => {
    const { data } = await apiClient.patch<Relationship>(
      `/api/v1/ontologies/${ontologyId}/relationships/${relationshipId}`,
      payload,
    );
    return data;
  },

  delete: async (ontologyId: string, relationshipId: string): Promise<void> => {
    await apiClient.delete(
      `/api/v1/ontologies/${ontologyId}/relationships/${relationshipId}`,
    );
  },
};
