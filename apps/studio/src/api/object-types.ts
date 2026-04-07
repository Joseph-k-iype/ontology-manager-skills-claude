import apiClient from './client';
import type { ObjectType, ObjectTypeCreate } from '@/types';

export const objectTypesApi = {
  list: async (ontologyId: string): Promise<ObjectType[]> => {
    const { data } = await apiClient.get<ObjectType[]>(
      `/api/v1/ontologies/${ontologyId}/object-types`,
    );
    return data;
  },

  get: async (ontologyId: string, objectTypeId: string): Promise<ObjectType> => {
    const { data } = await apiClient.get<ObjectType>(
      `/api/v1/ontologies/${ontologyId}/object-types/${objectTypeId}`,
    );
    return data;
  },

  create: async (payload: ObjectTypeCreate): Promise<ObjectType> => {
    const { data } = await apiClient.post<ObjectType>(
      `/api/v1/ontologies/${payload.ontology_id}/object-types`,
      payload,
    );
    return data;
  },

  update: async (
    ontologyId: string,
    objectTypeId: string,
    payload: Partial<Omit<ObjectTypeCreate, 'ontology_id'>>,
  ): Promise<ObjectType> => {
    const { data } = await apiClient.patch<ObjectType>(
      `/api/v1/ontologies/${ontologyId}/object-types/${objectTypeId}`,
      payload,
    );
    return data;
  },

  delete: async (ontologyId: string, objectTypeId: string): Promise<void> => {
    await apiClient.delete(
      `/api/v1/ontologies/${ontologyId}/object-types/${objectTypeId}`,
    );
  },
};
