import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import "@cloudflare/kumo/styles/standalone";
import "@fontsource-variable/inter";
import "./styles.css";
import { App } from "./App";
import { ToastProvider } from "./ui";
import { isDemoMode } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={isDemoMode() ? "/demo" : undefined}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
