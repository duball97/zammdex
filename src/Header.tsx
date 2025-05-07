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
  // Added flex-shrink-0 to prevent buttons from shrinking/distorting their text
  const buttonBaseStyle = "px-4 py-2 rounded-md text-sm font-medium flex-shrink-0";
  const activeButtonStyle = `${buttonBaseStyle} bg-gray-700 text-white`; // Example active style
  const inactiveButtonStyle = `${buttonBaseStyle} text-gray-300 hover:bg-gray-700 hover:text-white`;

  return (
    // Added min-w-0 to the header to help constrain its width if children overflow
    <header className="flex justify-between items-center w-full p-3 bg-gray-800 text-white mb-4 min-w-0">
      {/* Added flex-shrink-0 to prevent title from being squashed. mr-2 for some space. */}
      <div className="flex-shrink-0 mr-2">
        {/* You could put a logo or app title here if you like */}
        {/* <img src="/coinchan-logo.png" alt="Coinchan" className="h-8 w-auto" /> */}
        <span className="text-xl font-semibold">Coinchan</span>
      </div>
      {/* 
        - Added flex-wrap: allows nav items to wrap to the next line.
        - Added justify-end: aligns items to the right if they wrap.
        - Replaced space-x with gap-x/gap-y for better control with wrapping.
        - Added min-w-0: helps nav be constrained by its parent if its children (e.g., ConnectMenu) cause overflow.
      */}
      <nav className="flex items-center flex-wrap justify-end gap-x-2 gap-y-1 sm:gap-x-3 min-w-0">
        <button 
          onClick={() => setView('form')} 
          className={currentView === 'form' ? activeButtonStyle : inactiveButtonStyle}
        >
          Launch Coin
        </button>
        <button 
          onClick={() => setView('swap')} 
          className={currentView === 'swap' ? activeButtonStyle : inactiveButtonStyle}
        >
          Swap
        </button>
        <button 
          onClick={() => setView('explorer')} 
          className={currentView === 'explorer' ? activeButtonStyle : inactiveButtonStyle}
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