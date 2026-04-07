import apiClient from './client';
import type { Property, PropertyCreate } from '@/types';

export const propertiesApi = {
  list: async (objectTypeId: string): Promise<Property[]> => {
    const { data } = await apiClient.get<Property[]>(
      `/api/v1/object-types/${objectTypeId}/properties`,
    );
    return data;
  },

  get: async (objectTypeId: string, propertyId: string): Promise<Property> => {
    const { data } = await apiClient.get<Property>(
      `/api/v1/object-types/${objectTypeId}/properties/${propertyId}`,
    );
    return data;
  },

  create: async (payload: PropertyCreate): Promise<Property> => {
    const { data } = await apiClient.post<Property>(
      `/api/v1/object-types/${payload.object_type_id}/properties`,
      payload,
    );
    return data;
  },

  update: async (
    objectTypeId: string,
    propertyId: string,
    payload: Partial<Omit<PropertyCreate, 'object_type_id'>>,
  ): Promise<Property> => {
    const { data } = await apiClient.patch<Property>(
      `/api/v1/object-types/${objectTypeId}/properties/${propertyId}`,
      payload,
    );
    return data;
  },

  delete: async (objectTypeId: string, propertyId: string): Promise<void> => {
    await apiClient.delete(
      `/api/v1/object-types/${objectTypeId}/properties/${propertyId}`,
    );
  },
};
