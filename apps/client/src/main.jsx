import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(console.error));
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  window.__luxsyncspaceInstallPrompt = event;
  window.dispatchEvent(new CustomEvent("luxsyncspace:install-available"));
});

window.addEventListener("appinstalled", () => {
  window.__luxsyncspaceInstallPrompt = null;
  window.dispatchEvent(new CustomEvent("luxsyncspace:installed"));
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary key="luxsyncspace-recovery-v1"><App /></ErrorBoundary>
  </React.StrictMode>
);
