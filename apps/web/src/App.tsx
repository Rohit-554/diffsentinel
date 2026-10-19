import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { SystemStatus } from "./status/SystemStatus";

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <main>
        <h1>DiffSentinel</h1>
        <SystemStatus />
      </main>
    ),
  },
]);

export function App() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
