import { Send, Github, X } from 'lucide-react';

const Footer = () => {
  // Placeholder URLs - replace with actual links
  const socialLinks = {
    telegram: "https://telegram.org",
    github: "https://github.com",
    x: "https://x.com",
  };

  // Placeholder for view change, assuming a similar mechanism to App.tsx
  // You might need to pass down setView or use a global state/context
  const handleNavClick = (view: string) => {
    window.dispatchEvent(new CustomEvent('coinchan:setView', { detail: view }));
  };

  return (
    <footer className="w-full py-6 mt-auto text-center text-[var(--muted-foreground-light)] border-t border-[var(--border-light)]">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <p className="text-sm mb-4 md:mb-0">
            Zappr.fun. Powered by Coinchan &copy; {new Date().getFullYear()}
          </p>
          
          <div className="flex items-center space-x-4 mb-4 md:mb-0">
            <a href={socialLinks.telegram} target="_blank" rel="noopener noreferrer" title="Telegram" className="hover:text-[var(--primary-light)] transition-colors">
              <Send size={20} />
            </a>
            <a href={socialLinks.github} target="_blank" rel="noopener noreferrer" title="GitHub" className="hover:text-[var(--primary-light)] transition-colors">
              <Github size={20} />
            </a>
            <a href={socialLinks.x} target="_blank" rel="noopener noreferrer" title="X (Twitter)" className="hover:text-[var(--primary-light)] transition-colors">
              <X size={20} />
            </a>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--border-light)]/50 flex flex-wrap justify-center items-center gap-x-4 gap-y-2 text-sm">
          <button onClick={() => handleNavClick('swap')} className="hover:text-[var(--primary-light)] hover:underline transition-colors">
            Swap
          </button>
          <button onClick={() => handleNavClick('form')} className="hover:text-[var(--primary-light)] hover:underline transition-colors">
            Launch Coin
          </button>
          <button onClick={() => handleNavClick('explorer')} className="hover:text-[var(--primary-light)] hover:underline transition-colors">
            Explorer
          </button>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
