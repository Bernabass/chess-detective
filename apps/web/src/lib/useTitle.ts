import { useEffect } from 'react';

/** Sets the document title for a page: "Lab · Retrograde". */
export function useTitle(title: string | null): void {
  useEffect(() => {
    document.title = title === null ? 'Retrograde' : `${title} · Retrograde`;
  }, [title]);
}
