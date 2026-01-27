/**
 * MainContent Component
 * Contains the Three.js canvas and the entity panel
 */

import { ThreeCanvas } from '../three/ThreeCanvas';
import { Panel } from '../panel/Panel';

export function MainContent() {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Three.js canvas takes most of the space */}
      <div className="flex-1 relative">
        <ThreeCanvas />
      </div>

      {/* Entity details panel on the right */}
      <div className="w-80 shrink-0 border-l border-border bg-bg-secondary overflow-y-auto">
        <Panel />
      </div>
    </div>
  );
}

export default MainContent;

