import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ApiError } from './lib/problem';
import { routes } from './router';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 404 or 400 won't change on a retry; network errors and 5xx might.
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status < 500) && failures < 2,
    },
  },
});
const router = createBrowserRouter(routes);

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
