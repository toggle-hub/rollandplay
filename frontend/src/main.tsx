import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { AppShell } from "./AppShell";
import { SessionProvider } from "./auth/SessionContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <AppShell />
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
