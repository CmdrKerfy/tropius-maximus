/**
 * App shell — React Router entry. Explore lives at `/` (Phase 4+).
 */
import { Routes, Route } from "react-router-dom";
import RequireAuth from "./components/RequireAuth.jsx";
import AppLayout from "./layouts/AppLayout.jsx";
import ExplorePage from "./pages/ExplorePage.jsx";
import WorkbenchPage from "./pages/WorkbenchPage.jsx";
import DataHealthPage from "./pages/DataHealthPage.jsx";
import FieldsPage from "./pages/FieldsPage.jsx";
import BatchEditPage from "./pages/BatchEditPage.jsx";
import EditHistoryPage from "./pages/EditHistoryPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import AuthCallbackPage from "./pages/AuthCallbackPage.jsx";
import AuthResetPasswordPage from "./pages/AuthResetPasswordPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import PublicShareCardPage from "./pages/PublicShareCardPage.jsx";
import { isEmailAuthRequired } from "./lib/authInvite.js";

function Protected({ children }) {
  if (!isEmailAuthRequired()) return children;
  return <RequireAuth>{children}</RequireAuth>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/auth/reset-password" element={<AuthResetPasswordPage />} />
      <Route path="/share/card/:cardId" element={<PublicShareCardPage />} />
      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route path="/" element={<ExplorePage />} />
        <Route path="/workbench" element={<WorkbenchPage />} />
        <Route path="/health" element={<DataHealthPage />} />
        <Route path="/fields" element={<FieldsPage />} />
        <Route path="/batch" element={<BatchEditPage />} />
        <Route path="/history" element={<EditHistoryPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/profile/:userId" element={<ProfilePage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
    </Routes>
  );
}
