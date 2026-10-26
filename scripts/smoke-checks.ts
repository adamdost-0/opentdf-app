import { PermissionDeniedError } from '@opentdf/sdk';

export function isPolicyDenial(error: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (error instanceof PermissionDeniedError) return true;
  if (error instanceof AggregateError) {
    return error.errors.some((cause: unknown) =>
      isPolicyDenial(cause, depth + 1),
    );
  }
  return error instanceof Error && isPolicyDenial(error.cause, depth + 1);
}
