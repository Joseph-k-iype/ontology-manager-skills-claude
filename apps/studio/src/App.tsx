import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import HomePage from '@/pages/HomePage';
import SpacesPage from '@/pages/SpacesPage';
import SpacePage from '@/pages/SpacePage';
import OntologyPage from '@/pages/OntologyPage';
import { Toast } from '@/components/ui/toast';
import { useAppStore } from '@/stores/app-store';

// Lazy-load the G6 exploration view — never in the main bundle
const ExplorePage = React.lazy(() => import('@/pages/ExplorePage'));

function ToastContainer() {
  const { toasts, removeToast } = useAppStore();
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="spaces" element={<SpacesPage />} />
          <Route path="spaces/:spaceId" element={<SpacePage />} />
        </Route>

        {/* Full-screen canvas routes — no app chrome sidebar */}
        <Route
          path="spaces/:spaceId/ontology/:ontologyId"
          element={<OntologyPage />}
        />
        <Route
          path="spaces/:spaceId/ontology/:ontologyId/explore"
          element={
            <Suspense
              fallback={
                <div className="flex h-screen items-center justify-center bg-canvas-bg">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                    <span className="text-sm text-gray-400">Loading exploration view…</span>
                  </div>
                </div>
              }
            >
              <ExplorePage />
            </Suspense>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <ToastContainer />
    </BrowserRouter>
  );
}
