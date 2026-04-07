import React from 'react';
import { Outlet } from 'react-router-dom';
import TopBar from './TopBar';
import AppSidebar from './Sidebar';

export default function AppLayout() {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
