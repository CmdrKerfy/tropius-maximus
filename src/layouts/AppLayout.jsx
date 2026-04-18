import { Outlet } from "react-router-dom";
import { useExperimentalAppNav } from "../lib/navEnv.js";
import AppShellHeader from "../components/AppShellHeader.jsx";

export default function AppLayout() {
  const experimentalNav = useExperimentalAppNav();
  return (
    <>
      {experimentalNav ? <AppShellHeader /> : null}
      <Outlet />
    </>
  );
}
