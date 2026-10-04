import Link from "next/link";

export const Footer = () => (
  <footer className="bq-footer">
    <div>
      <strong>basqit.</strong>
      <span>Build a basket. Send a gift. Open a pack.</span>
      <Link href="/tokenized-stocks">Tokenized stocks on Robinhood Chain</Link>
    </div>
    <div>
      <span className="badge bq-status">Early preview</span>
    </div>
  </footer>
);
