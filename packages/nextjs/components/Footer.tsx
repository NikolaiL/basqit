import Link from "next/link";

export const Footer = () => (
  <footer className="bq-footer">
    <div>
      <strong>basqit.</strong>
      <span>A clearer view of your Stock Tokens.</span>
    </div>
    <div>
      <span className="badge bq-status">Read-only preview</span>
      <Link className="link" href="/debug">
        Developer tools
      </Link>
    </div>
  </footer>
);
