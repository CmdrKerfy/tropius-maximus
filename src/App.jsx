/**
 * App shell — React Router entry. Explore lives at `/` (Phase 4+).
 */
import { Routes, Route } from "react-router-dom";
import ExplorePage from "./pages/ExplorePage.jsx";
import WorkbenchPage from "./pages/WorkbenchPage.jsx";
import DataHealthPage from "./pages/DataHealthPage.jsx";
import FieldsPage from "./pages/FieldsPage.jsx";
import BatchEditPage from "./pages/BatchEditPage.jsx";
import EditHistoryPage from "./pages/EditHistoryPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ExplorePage />} />
      <Route path="/workbench" element={<WorkbenchPage />} />
      <Route path="/health" element={<DataHealthPage />} />
      <Route path="/fields" element={<FieldsPage />} />
      <Route path="/batch" element={<BatchEditPage />} />
      <Route path="/history" element={<EditHistoryPage />} />
    </Routes>
  );
}
