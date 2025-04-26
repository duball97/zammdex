import { sdk } from "@farcaster/frame-sdk";
import "./index.css";
import { useEffect, useState } from "react";
import { CoinPaper } from "./CoinPaper";
import { CoinForm } from "./CoinForm";
import Coins from "./Coins";
import { ConnectMenu } from "./ConnectMenu";

function App() {
  const [view, setView] = useState<"menu" | "form" | "memepaper">("menu");
  const [tapCount, setTapCount] = useState(0);
  const [lastTap, setLastTap] = useState(0);

  useEffect(() => {
    sdk.actions.ready();
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

  return (
    <main>
      <header>
        <ConnectMenu />
      </header>
      <img
        src="/coinchan-logo.png"
        alt="Coinchan"
        className={`logo ${view !== "menu" ? "small" : ""}`}
        onClick={handleLogoTap}
        onTouchStart={handleLogoTap}
      />

      {view === "form" && (
        <div className="container">
          <CoinForm onMemepaperClick={handleMemepaperClick} />
        </div>
      )}
      {view === "memepaper" && <CoinPaper onCoinClick={handleCoinClick} />}
      {view === "menu" && (
        <div className="container">
          <Coins />
          <div className="main-menu">
            {/* <ConnectMenu /> */}
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
    </main>
  );
}

export default App;
