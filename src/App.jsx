/**
 * App shell — React Router entry. Explore lives at `/` (Phase 4+).
 */
import { Component, lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import RequireAuth from "./components/RequireAuth.jsx";
import AppLayout from "./layouts/AppLayout.jsx";
// Auth pages stay eager (tiny, needed at startup):
import LoginPage from "./pages/LoginPage.jsx";
import AuthCallbackPage from "./pages/AuthCallbackPage.jsx";
import AuthResetPasswordPage from "./pages/AuthResetPasswordPage.jsx";
import { isEmailAuthRequired } from "./lib/authInvite.js";

// Route-level code splitting — each page is a separate chunk:
const ExplorePage = lazy(() => import("./pages/ExplorePage.jsx"));
const WorkbenchPage = lazy(() => import("./pages/WorkbenchPage.jsx"));
const DataHealthPage = lazy(() => import("./pages/DataHealthPage.jsx"));
const FieldsPage = lazy(() => import("./pages/FieldsPage.jsx"));
const BatchEditPage = lazy(() => import("./pages/BatchEditPage.jsx"));
const EditHistoryPage = lazy(() => import("./pages/EditHistoryPage.jsx"));
const DashboardPage = lazy(() => import("./pages/DashboardPage.jsx"));
const ProfilePage = lazy(() => import("./pages/ProfilePage.jsx"));
const PublicShareCardPage = lazy(() => import("./pages/PublicShareCardPage.jsx"));

function Protected({ children }) {
  if (!isEmailAuthRequired()) return children;
  return <RequireAuth>{children}</RequireAuth>;
}

class ChunkErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    // Auto-reload on chunk load failures (stale index.html after deploy).
    const msg = String(error?.message ?? "");
    if (
      msg.includes("dynamically imported") ||
      msg.includes("Failed to fetch") ||
      msg.includes("module script") ||
      msg.includes("Loading chunk")
    ) {
      window.location.reload();
    }
  }
  render() {
    if (this.state.error) {
      const msg = String(this.state.error?.message ?? "");
      const name = String(this.state.error?.name ?? "Error");
      return (
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="text-center max-w-md">
            <p className="text-lg font-semibold text-gray-800">Failed to load page</p>
            <details className="mt-2 text-left">
              <summary className="text-sm text-gray-500 cursor-pointer">Error details</summary>
              <pre className="mt-2 text-xs text-gray-600 bg-gray-100 rounded p-2 overflow-auto max-h-40 text-left">
                {name}: {msg}
              </pre>
            </details>
            <p className="text-sm text-gray-600 mt-2">
              A new version may have been deployed. Try refreshing the page.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-tm-leaf px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-tm-leaf-muted"
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ChunkErrorBoundary>
    <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading…</div>}>
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
    </Suspense>
    </ChunkErrorBoundary>
  );
}
