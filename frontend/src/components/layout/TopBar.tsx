/**
 * TopBar Component
 * Contains board selector and resource bar
 */

import { BoardSelector } from '../board/BoardSelector';
import { ResourceBar } from '../resources/ResourceBar';

interface TopBarProps {
  onSettingsClick: () => void;
}

export function TopBar({ onSettingsClick }: TopBarProps) {
  return (
    <div className="flex items-center h-14 px-4 bg-bg-secondary border-b border-border shrink-0">
      {/* Board selector on the left */}
      <div className="flex-shrink-0">
        <BoardSelector />
      </div>

      {/* Resource bar takes remaining space */}
      <div className="flex-1 ml-4">
        <ResourceBar onSettingsClick={onSettingsClick} />
      </div>
    </div>
  );
}

export default TopBar;

