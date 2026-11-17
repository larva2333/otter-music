import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./assets/global.css";
import RootLayout from "./Layout";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initializeLogger } from "./lib/logger";
import { initAutoBackup } from "./lib/utils/auto-backup";

initializeLogger();
initAutoBackup();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <RootLayout>
        <App />
      </RootLayout>
    </ErrorBoundary>
  </StrictMode>
);
