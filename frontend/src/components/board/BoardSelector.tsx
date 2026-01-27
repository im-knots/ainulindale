/**
 * BoardSelector Component
 * Dropdown to select and create boards
 */

import { useState, useRef, useEffect } from 'react';
import { useBoards, useCurrentBoard } from '../../store/hooks';
import { loadBoard, createBoard, deleteBoard } from '../../store/persistence';

export function BoardSelector() {
  const boards = useBoards();
  const currentBoard = useCurrentBoard();
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectBoard = async (boardId: string) => {
    await loadBoard(boardId);
    setIsOpen(false);
  };

  const handleCreateBoard = async () => {
    if (!newBoardName.trim()) return;
    const board = await createBoard(newBoardName.trim());
    await loadBoard(board.id);
    setNewBoardName('');
    setIsCreating(false);
    setIsOpen(false);
  };

  const handleDeleteBoard = async (boardId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (confirm('Delete this board? This cannot be undone.')) {
      await deleteBoard(boardId);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Board selector button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary rounded-md hover:bg-bg-elevated transition-colors"
      >
        <span className="text-sm text-text-primary">
          {currentBoard?.name ?? 'Select Board'}
        </span>
        <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-bg-elevated border border-border rounded-lg shadow-lg z-50">
          {/* Board list */}
          <div className="max-h-60 overflow-y-auto p-1">
            {boards.map((board) => (
              <div
                key={board.id}
                onClick={() => handleSelectBoard(board.id)}
                className={`group flex items-center justify-between px-3 py-2 rounded-md cursor-pointer ${
                  currentBoard?.id === board.id
                    ? 'bg-accent-primary/20 text-text-primary'
                    : 'text-text-secondary hover:bg-bg-tertiary'
                }`}
              >
                <span className="text-sm truncate flex-1">{board.name}</span>
                <button
                  onClick={(e) => handleDeleteBoard(board.id, e)}
                  className="p-1 text-text-muted hover:text-accent-danger opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                  title="Delete board"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Create new board */}
          <div className="border-t border-border p-2">
            {isCreating ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateBoard()}
                  placeholder="Board name"
                  className="input flex-1 text-sm"
                  autoFocus
                />
                <button onClick={handleCreateBoard} className="btn btn-primary text-sm">
                  Create
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreating(true)}
                className="w-full px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-md"
              >
                + New Board
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default BoardSelector;

