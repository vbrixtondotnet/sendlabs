import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { App } from "./App";
import { RoleProvider } from "./hooks/useRole";
import { ToastProvider } from "./hooks/useToast";
import { ApiClientError } from "./services/http";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Retrying cannot fix a 4xx (validation, not found, auth). Retry only network and server failures, once.
      retry: (count, err) => count < 1 && !(err instanceof ApiClientError && err.status >= 400 && err.status < 500),
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RoleProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </RoleProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
