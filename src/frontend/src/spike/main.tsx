/* Spike #293 — dev-only entry. Not part of the production bundle. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/spike/beautifui/foundation.css";
import SpikePage from "@/spike/SpikePage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SpikePage />
  </StrictMode>,
);
