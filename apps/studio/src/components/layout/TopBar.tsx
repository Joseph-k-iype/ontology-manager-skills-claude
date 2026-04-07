import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { Menu, Bell, Search, ChevronRight } from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import { useSpace } from '@/hooks/use-spaces';

export default function TopBar() {
  const { toggleSidebar } = useAppStore();
  const { spaceId } = useParams<{ spaceId: string }>();
  const spaceQuery = useSpace(spaceId ?? '');

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shrink-0 z-20">
      {/* Hamburger */}
      <button
        onClick={toggleSidebar}
        className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-gray-500 flex-1 min-w-0">
        <Link to="/" className="hover:text-gray-900 transition-colors shrink-0">
          EOM Studio
        </Link>
        {spaceId && spaceQuery.data && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            <Link
              to={`/spaces/${spaceId}`}
              className="hover:text-gray-900 transition-colors truncate"
            >
              {spaceQuery.data.name}
            </Link>
          </>
        )}
      </nav>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <button className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors">
          <Search className="h-4 w-4" />
        </button>
        <button className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors">
          <Bell className="h-4 w-4" />
        </button>
        <div className="ml-2 h-7 w-7 rounded-full bg-primary-600 flex items-center justify-center text-white text-xs font-semibold select-none">
          U
        </div>
      </div>
    </header>
  );
}
