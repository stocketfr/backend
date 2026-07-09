import { format } from 'date-fns';

export function generateOrderPrefix(date: Date): string {
  return `ORD-${format(date, 'yyyyMMdd')}`;
}
