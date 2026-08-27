import { useRef, useEffect } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import type { ElementDefinition, Core } from 'cytoscape';

interface CortexCanvasProps {
  elements: ElementDefinition[];
  agentFocusNodeIds: string[];
}

export function CortexCanvas({ elements, agentFocusNodeIds }: CortexCanvasProps) {
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (cyRef.current) {
      const cy = cyRef.current;
      
      // Reset all
      cy.elements().removeClass('cyan-pulse amber-glow crimson-web');
      
      // Apply focus classes
      agentFocusNodeIds.forEach(id => {
        const node = cy.getElementById(id);
        if (node) {
          node.addClass('amber-glow');
          
          // Animate edges pointing to/from it
          node.connectedEdges().addClass('cyan-pulse');
        }
      });
      
      // Auto-layout on elements change
      cy.layout({ name: 'cose', animate: true, animationDuration: 300 }).run();
    }
  }, [elements, agentFocusNodeIds]);

  return (
    <div className="w-full h-full bg-zinc-950 border border-zinc-900 rounded-lg overflow-hidden relative group">
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2 bg-zinc-900/80 p-1.5 rounded-md border border-zinc-800 backdrop-blur-sm">
        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
        <span className="text-[9px] font-mono font-bold text-zinc-300 tracking-wider">CORTEX ONLINE</span>
      </div>
      
      <CytoscapeComponent
        elements={elements}
        style={{ width: '100%', height: '100%' }}
        stylesheet={[
          {
            selector: 'node[type="class"]',
            style: {
              'background-color': '#2563eb', // blue
              'shape': 'rectangle',
              'label': 'data(label)',
              'color': '#cbd5e1',
              'font-size': '8px',
              'text-valign': 'center',
              'text-halign': 'center',
              'width': 'label',
              'height': '20px',
              'padding': '10px'
            }
          },
          {
            selector: 'node[type="chunk"]',
            style: {
              'background-color': '#6366f1', // indigo
              'shape': 'round-rectangle',
              'label': 'data(label)',
              'color': '#e2e8f0',
              'font-size': '8px',
              'text-valign': 'center',
              'text-halign': 'center',
              'width': 'label',
              'height': '15px',
              'padding': '8px',
              'border-width': 1,
              'border-color': '#4f46e5',
              'border-style': 'dashed'
            }
          },
          {
            selector: 'node[type="function"], node[type="method"]',
            style: {
              'background-color': '#0d9488', // teal
              'shape': 'ellipse',
              'label': 'data(label)',
              'color': '#cbd5e1',
              'font-size': '8px',
              'text-valign': 'center',
              'text-halign': 'center',
              'width': '60px',
              'height': '30px'
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 1.5,
              'line-color': '#52525b',
              'target-arrow-color': '#52525b',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'opacity': 0.6
            }
          },
          {
            selector: 'edge[type="calls"]',
            style: {
              'line-style': 'dashed',
              'line-color': '#06b6d4', // cyan
              'target-arrow-color': '#06b6d4'
            }
          },
          // Animation States
          {
            selector: '.cyan-pulse',
            style: {
              'line-color': '#22d3ee',
              'target-arrow-color': '#22d3ee',
              'width': 2.5,
              'transition-property': 'width, line-color',
              'transition-duration': 0.5
            }
          },
          {
            selector: '.amber-glow',
            style: {
              'background-color': '#f59e0b',
              'border-width': 2,
              'border-color': '#fcd34d',
              'transition-property': 'background-color, border-width',
              'transition-duration': 0.5
            }
          }
        ]}
        cy={(cy) => { cyRef.current = cy; }}
      />
    </div>
  );
}
