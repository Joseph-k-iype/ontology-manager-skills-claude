import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import type { ObjectTypeNodeData, RelationshipEdgeData } from '@/types';

type OntologyNode = Node<ObjectTypeNodeData>;
type OntologyEdge = Edge<RelationshipEdgeData>;

interface CanvasStore {
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  selectedNodeId: string | null;
  isPanelOpen: boolean;

  setNodes: (nodes: OntologyNode[]) => void;
  setEdges: (edges: OntologyEdge[]) => void;
  addNode: (node: OntologyNode) => void;
  addEdge: (edge: OntologyEdge) => void;
  updateNode: (id: string, data: Partial<ObjectTypeNodeData>) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  selectNode: (id: string | null) => void;
  openPanel: () => void;
  closePanel: () => void;
  reset: () => void;
}

export const useCanvasStore = create<CanvasStore>()((set) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  isPanelOpen: false,

  setNodes: (nodes) => set({ nodes }),

  setEdges: (edges) => set({ edges }),

  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
    })),

  addEdge: (edge) =>
    set((state) => ({
      edges: [...state.edges, edge],
    })),

  updateNode: (id, data) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
      ),
    })),

  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    })),

  removeEdge: (id) =>
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
    })),

  selectNode: (id) =>
    set({ selectedNodeId: id, isPanelOpen: id !== null }),

  openPanel: () => set({ isPanelOpen: true }),

  closePanel: () => set({ isPanelOpen: false, selectedNodeId: null }),

  reset: () => set({ nodes: [], edges: [], selectedNodeId: null, isPanelOpen: false }),
}));
