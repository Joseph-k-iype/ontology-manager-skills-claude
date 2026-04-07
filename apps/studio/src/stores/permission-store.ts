import { create } from 'zustand';
import type { ActionPermission, ResourceType } from '@/types';

interface PermissionEntry {
  resourceType: ResourceType;
  resourceId: string;
  permissions: ActionPermission[];
}

interface PermissionStore {
  userId: string | null;
  userRoles: string[];
  permissionCache: Map<string, ActionPermission[]>;

  setUserId: (id: string | null) => void;
  setUserRoles: (roles: string[]) => void;
  setPermissions: (entry: PermissionEntry) => void;
  hasPermission: (
    resourceType: ResourceType,
    resourceId: string,
    action: ActionPermission,
  ) => boolean;
  clearPermissions: () => void;
}

const cacheKey = (resourceType: ResourceType, resourceId: string) =>
  `${resourceType}:${resourceId}`;

export const usePermissionStore = create<PermissionStore>()((set, get) => ({
  userId: null,
  userRoles: [],
  permissionCache: new Map(),

  setUserId: (id) => set({ userId: id }),

  setUserRoles: (roles) => set({ userRoles: roles }),

  setPermissions: ({ resourceType, resourceId, permissions }) =>
    set((state) => {
      const next = new Map(state.permissionCache);
      next.set(cacheKey(resourceType, resourceId), permissions);
      return { permissionCache: next };
    }),

  hasPermission: (resourceType, resourceId, action) => {
    const { permissionCache } = get();
    const permissions = permissionCache.get(cacheKey(resourceType, resourceId));
    return permissions?.includes(action) ?? false;
  },

  clearPermissions: () => set({ permissionCache: new Map() }),
}));
