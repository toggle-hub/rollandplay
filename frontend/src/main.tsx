import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { AppShell } from "./AppShell";
import { SessionProvider } from "./auth/SessionContext";
import { ToastProvider } from "./components/Toast";
import { NotificationsProvider } from "./notifications/NotificationsContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <NotificationsProvider>
            <AppShell />
          </NotificationsProvider>
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
