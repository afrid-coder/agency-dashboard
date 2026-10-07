import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { LumeraLogo } from '../../components/LumeraLogo.tsx';

/** Split layout for account pages: a quiet brand column and the form. */
export function AuthLayout({ title, subtitle, children, footer, eyebrow }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; eyebrow?: string }) {
  useEffect(() => {
    document.title = `${title} · Lumera Creative`;
  }, [title]);
  return (
    <div className="auth">
      <aside className="auth-brand" aria-hidden="true">
        <Link to="/" className="auth-logo" tabIndex={-1}>
          <LumeraLogo size={34} /> Lumera Creative
        </Link>
        <p className="auth-quote">
          The studio’s
          <br />
          <em>operating room.</em>
        </p>
        <ul className="auth-points">
          <li>Shared calendar and agency workflows</li>
          <li>Profit tracked against the monthly goal</li>
          <li>Lume, an assistant that asks before it acts</li>
        </ul>
        <p className="auth-foot">Owners join with the admin code; the team by invitation.</p>
      </aside>
      <main className="auth-main" id="main">
        <Link to="/" className="auth-logo auth-logo-mobile">
          <LumeraLogo size={30} /> Lumera Creative
        </Link>
        <div className="auth-card">
          {eyebrow && <p className="mono-label">{eyebrow}</p>}
          <h1 className="auth-title">{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          <div className="auth-body">{children}</div>
        </div>
        {footer && <div className="auth-footer">{footer}</div>}
      </main>
    </div>
  );
}
