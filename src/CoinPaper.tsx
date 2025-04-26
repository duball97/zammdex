const stats = [
  { label: "Total Supply", value: "21 000 000", emoji: "💰" },
  { label: "Swap Fee", value: "1 %", emoji: "💱" },
  { label: "Vesting", value: "6 months", emoji: "⏰" },
  { label: "Pool Supply", value: "21 000 000", emoji: "🏦" },
];

export const CoinPaper = ({ onCoinClick }: { onCoinClick: () => void }) => (
  <div className="container">
    <div className="content">
      <div className="stats">
        {stats.map(({ label, value, emoji }) => (
          <div key={label} className="stat-card">
            <span className="stat-icon">{emoji}</span>
            <div className="stat-text">
              <div className="label">{label}</div>
              <div className="value">{value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="explanation">
        <p>
          <strong>Coinchan</strong> is an extremely efficient coin launcher for
          Ethereum via the <strong>ERC6909</strong> standard. All{" "}
          <em>21 000 000</em> tokens are initially locked in an AMM pool for
          fair distribution while creators earn swap fees. Sound good?
        </p>
        <ul>
          <li>
            <strong>Total Supply:</strong> Fixed at 21 000 000 — no more can
            ever be minted.
          </li>
          <li>
            <strong>Pool Supply:</strong> 100% of coins go straight into the
            liquidity pool — everyone trades on the same footing.
          </li>
          <li>
            <strong>Swap Fee:</strong> A 1% fee is taken on each trade by the
            AMM which goes back to the creator.
          </li>
          <li>
            <strong>Vesting:</strong> Creator LP tokens are linearly vested over
            6 months to prove long‑term commitment.
          </li>
          <li>
            <strong>ERC6909:</strong> Extends ERC20 with singleton state (one
            contract, all coins), metadata (tokenURI) support, and backwards
            compatibility with existing ERC20 DeFi.
          </li>
        </ul>
      </div>

      <button className="text-button" onClick={onCoinClick}>
        I want to coin it!
      </button>
    </div>
  </div>
);
