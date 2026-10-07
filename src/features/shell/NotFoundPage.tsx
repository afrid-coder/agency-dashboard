import { Link } from 'react-router';
import { EmptyState } from '../../components/ui.tsx';

export function NotFoundPage() {
  return (
    <div className="page">
      <EmptyState icon="info" title="This page doesn’t exist" action={<Link to="/app" className="btn btn-secondary btn-md">Back to the dashboard</Link>}>
        The link may be out of date, or the record may have been deleted.
      </EmptyState>
    </div>
  );
}
