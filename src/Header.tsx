import React from 'react';
import { ConnectMenu } from './ConnectMenu';

// Define the possible view states that the Header can navigate to.
// This should match the view states in App.tsx.
export type AppView = "menu" | "form" | "memepaper" | "swap" | "explorer";

interface HeaderProps {
  setView: (view: AppView) => void;
  currentView: AppView;
}

export const Header: React.FC<HeaderProps> = ({ setView, currentView }) => {
  const buttonBaseStyle = "px-4 py-2 rounded-[var(--radius-md)] text-sm font-medium flex-shrink-0 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-light)]";
  const activeButtonStyle = `${buttonBaseStyle} bg-[var(--primary-light)] text-[var(--primary-foreground-light)]`;
  const inactiveButtonStyle = `${buttonBaseStyle} bg-transparent text-[var(--muted-foreground-light)] hover:bg-[var(--secondary-light)] hover:text-[var(--secondary-foreground-light)]`;
  // Dark mode styles (will apply if .dark class is on a parent)
  const darkActiveButtonStyle = `dark:bg-[var(--primary-dark)] dark:text-[var(--primary-foreground-dark)]`;
  const darkInactiveButtonStyle = `dark:text-[var(--muted-foreground-dark)] dark:hover:bg-[var(--secondary-dark)] dark:hover:text-[var(--secondary-foreground-dark)] dark:focus-visible:outline-[var(--ring-dark)]`;

  return (
    // Added min-w-0 to the header to help constrain its width if children overflow
    <header className="flex justify-between items-center w-full p-3 bg-[var(--card-background-light)] dark:bg-[var(--card-background-dark)] text-[var(--foreground-light)] dark:text-[var(--foreground-dark)] mb-6 shadow-sm border-b border-[var(--card-border-light)] dark:border-[var(--card-border-dark)] min-w-0">
      {/* Added flex-shrink-0 to prevent title from being squashed. mr-2 for some space. */}
      <div className="flex-shrink-0 mr-3">
        {/* Changed website name */}
        <span className="text-xl font-semibold text-[var(--foreground-light)] dark:text-[var(--foreground-dark)]">Zappr.fun</span>
      </div>
      {/* 
        - Added flex-wrap: allows nav items to wrap to the next line.
        - Added justify-end: aligns items to the right if they wrap.
        - Replaced space-x with gap-x/gap-y for better control with wrapping.
        - Added min-w-0: helps nav be constrained by its parent if its children (e.g., ConnectMenu) cause overflow.
      */}
      <nav className="flex items-center flex-wrap justify-end gap-x-2 gap-y-2 sm:gap-x-3 min-w-0">
        <button 
          onClick={() => setView('form')}
          className={`${currentView === 'form' ? activeButtonStyle : inactiveButtonStyle} ${currentView === 'form' ? darkActiveButtonStyle : darkInactiveButtonStyle}`}
        >
          Launch Coin
        </button>
        <button 
          onClick={() => setView('swap')}
          className={`${currentView === 'swap' ? activeButtonStyle : inactiveButtonStyle} ${currentView === 'swap' ? darkActiveButtonStyle : darkInactiveButtonStyle}`}
        >
          Swap
        </button>
        <button 
          onClick={() => setView('explorer')}
          className={`${currentView === 'explorer' ? activeButtonStyle : inactiveButtonStyle} ${currentView === 'explorer' ? darkActiveButtonStyle : darkInactiveButtonStyle}`}
        >
          Explorer
        </button>
        {/* 
          Wrapped ConnectMenu in a div that is also a flex item.
          min-w-0 helps this wrapper be constrained by the nav's flex layout,
          which is important if ConnectMenu itself doesn't manage its minimum size well.
        */}
        <div className="flex items-center min-w-0">
          <ConnectMenu />
        </div>
      </nav>
    </header>
  );
};