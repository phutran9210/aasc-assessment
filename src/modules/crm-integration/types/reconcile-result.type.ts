export type ReconcileResult<T> =
  | { status: 'found'; value: T }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidates: T[] };
