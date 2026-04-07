import apiClient from './client';
import type { Space, SpaceCreate } from '@/types';

export const spacesApi = {
  list: async (): Promise<Space[]> => {
    const { data } = await apiClient.get<Space[]>('/api/v1/spaces');
    return data;
  },

  get: async (id: string): Promise<Space> => {
    const { data } = await apiClient.get<Space>(`/api/v1/spaces/${id}`);
    return data;
  },

  create: async (payload: SpaceCreate): Promise<Space> => {
    const { data } = await apiClient.post<Space>('/api/v1/spaces', payload);
    return data;
  },

  update: async (id: string, payload: Partial<SpaceCreate>): Promise<Space> => {
    const { data } = await apiClient.patch<Space>(`/api/v1/spaces/${id}`, payload);
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/v1/spaces/${id}`);
  },
};
