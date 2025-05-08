import { sdk } from "@farcaster/frame-sdk";
import "./index.css";
import { useEffect, useState } from "react";
import { CoinPaper } from "./CoinPaper";
import { CoinForm } from "./CoinForm";
import Coins from "./Coins";
// import { ConnectMenu } from "./ConnectMenu"; // ConnectMenu is used in Header.tsx
import SwapTile from "./SwapTile";
import { Header, AppView } from "./Header.tsx"; // Explicitly add .tsx extension
// import { ExplorerView } from "./ExplorerView"; // No longer need the placeholder

function App() {
  const [view, setView] = useState<AppView>("swap");
  const [tapCount, setTapCount] = useState(0);
  const [lastTap, setLastTap] = useState(0);

  useEffect(() => {
    sdk.actions.ready();
    
    // Listen for custom view change events
    const handleViewChange = (event: CustomEvent) => {
      if (event.detail && typeof event.detail === 'string') {
        setView(event.detail as AppView);
      }
    };
    
    window.addEventListener('coinchan:setView', handleViewChange as EventListener);
    
    return () => {
      window.removeEventListener('coinchan:setView', handleViewChange as EventListener);
    };
  }, []);

  const handleLogoTap = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (now - lastTap < 300) {
      setView((prevView) => (prevView === "form" ? "menu" : "form")); // Toggle view
    }
    setLastTap(now);
    setTapCount(tapCount + 1);
  };

  const handleMemepaperClick = () => {
    setView("memepaper");
  };

  const handleCoinClick = () => {
    setView("form");
  };

  const handleSwapClick = () => {
    setView("swap");
  };

  return (
    <main className="p-0 sm:p-0 min-h-screen w-screen flex flex-col items-center">
      <Header setView={setView} currentView={view} />
      
      <div className={`w-full px-2 sm:px-4 mt-4 mb-8 ${view === 'explorer' ? 'max-w-6xl' : 'max-w-lg'}`}>
        {view !== "menu" && view !== "explorer" && view !== "form" && (
          <img
            src="/coinchan-logo.png"
            alt="Coinchan"
            className={`logo mx-auto mb-4 ${view !== "memepaper" ? "small" : ""}`}
            onClick={handleLogoTap}
            onTouchStart={handleLogoTap}
          />
        )}

        {view === "form" && (
          <div className="">
            <CoinForm />
          </div>
        )}
        {view === "memepaper" && <CoinPaper onCoinClick={handleCoinClick} />}
        {view === "swap" && <SwapTile />}
        {view === "explorer" && (
          <div className="w-full">
            <h2 className="text-2xl font-semibold text-[var(--foreground-light)] dark:text-[var(--foreground-dark)] text-center mb-4">Coin Explorer</h2>
            <Coins />
          </div>
        )}
        
        {view === "menu" && (
          <div className="text-white">
            <img
              src="/coinchan-logo.png"
              alt="Coinchan"
              className="logo mx-auto mb-4"
              onClick={handleLogoTap}
              onTouchStart={handleLogoTap}
            />
            <div>
              <div className="flex justify-center items-center w-full">
                <button
                  className={`appearance-none mt-6 mx-auto flex items-center gap-2 px-5 py-2 bg-white hover:scale-105 font-mono text-red-500 transition-colors duration-200`}
                  onClick={handleSwapClick}
                >
                  Swap
                </button>
              </div>
            </div>
            <div className="w-full">
              <Coins />
            </div>
            <div className="main-menu">
              <div className="flex justify-end items-end w-full">
                <button
                  className={`appearance-none mt-6 mx-auto flex items-center gap-2 px-5 py-2 bg-white hover:scale-105 font-mono text-red-500 transition-colors duration-200`}
                  onClick={handleMemepaperClick}
                >
                  🤓 Read the Coinpaper
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
