/**
 * App shell — React Router entry. Explore lives at `/` (Phase 4+).
 */
import { Routes, Route } from "react-router-dom";
import RequireAuth from "./components/RequireAuth.jsx";
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
      <Route
        path="/"
        element={
          <Protected>
            <ExplorePage />
          </Protected>
        }
      />
      <Route
        path="/workbench"
        element={
          <Protected>
            <WorkbenchPage />
          </Protected>
        }
      />
      <Route
        path="/health"
        element={
          <Protected>
            <DataHealthPage />
          </Protected>
        }
      />
      <Route
        path="/fields"
        element={
          <Protected>
            <FieldsPage />
          </Protected>
        }
      />
      <Route
        path="/batch"
        element={
          <Protected>
            <BatchEditPage />
          </Protected>
        }
      />
      <Route
        path="/history"
        element={
          <Protected>
            <EditHistoryPage />
          </Protected>
        }
      />
      <Route
        path="/dashboard"
        element={
          <Protected>
            <DashboardPage />
          </Protected>
        }
      />
      <Route
        path="/profile"
        element={
          <Protected>
            <ProfilePage />
          </Protected>
        }
      />
    </Routes>
  );
}
