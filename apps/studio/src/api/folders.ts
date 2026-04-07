import apiClient from './client';
import type { Folder, FolderCreate } from '@/types';

export const foldersApi = {
  list: async (spaceId: string): Promise<Folder[]> => {
    const { data } = await apiClient.get<Folder[]>(`/api/v1/spaces/${spaceId}/folders`);
    return data;
  },

  get: async (spaceId: string, folderId: string): Promise<Folder> => {
    const { data } = await apiClient.get<Folder>(
      `/api/v1/spaces/${spaceId}/folders/${folderId}`,
    );
    return data;
  },

  create: async (payload: FolderCreate): Promise<Folder> => {
    const { data } = await apiClient.post<Folder>(
      `/api/v1/spaces/${payload.space_id}/folders`,
      payload,
    );
    return data;
  },

  update: async (
    spaceId: string,
    folderId: string,
    payload: Pick<FolderCreate, 'name'>,
  ): Promise<Folder> => {
    const { data } = await apiClient.patch<Folder>(
      `/api/v1/spaces/${spaceId}/folders/${folderId}`,
      payload,
    );
    return data;
  },

  delete: async (spaceId: string, folderId: string): Promise<void> => {
    await apiClient.delete(`/api/v1/spaces/${spaceId}/folders/${folderId}`);
  },
};
