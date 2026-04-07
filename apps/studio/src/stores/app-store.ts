import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ToastMessage } from '@/types';

interface AppStore {
  currentSpaceId: string | null;
  currentFolderId: string | null;
  currentOntologyId: string | null;
  sidebarOpen: boolean;
  toasts: ToastMessage[];

  setCurrentSpace: (id: string | null) => void;
  setCurrentFolder: (id: string | null) => void;
  setCurrentOntology: (id: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      currentSpaceId: null,
      currentFolderId: null,
      currentOntologyId: null,
      sidebarOpen: true,
      toasts: [],

      setCurrentSpace: (id) =>
        set({ currentSpaceId: id, currentFolderId: null, currentOntologyId: null }),

      setCurrentFolder: (id) =>
        set({ currentFolderId: id, currentOntologyId: null }),

      setCurrentOntology: (id) => set({ currentOntologyId: id }),

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      addToast: (toast) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
        // Auto-remove after 5 seconds
        setTimeout(() => {
          set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
        }, 5000);
      },

      removeToast: (id) =>
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'eom-app-store',
      partialize: (state) => ({
        currentSpaceId: state.currentSpaceId,
        currentFolderId: state.currentFolderId,
        currentOntologyId: state.currentOntologyId,
        sidebarOpen: state.sidebarOpen,
      }),
    },
  ),
);
