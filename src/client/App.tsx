import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Overview } from "@/pages/Overview";
import { Imports } from "@/pages/Imports";
import { Contacts } from "@/pages/Contacts";
import { Campaigns } from "@/pages/Campaigns";
import { CampaignEditor } from "@/pages/CampaignEditor";
import { CampaignDetails } from "@/pages/CampaignDetails";
import { Settings } from "@/pages/Settings";
import { AcceptInvitation } from "@/pages/AcceptInvitation";
import { Login } from "@/pages/Login";

export function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="invite/:token" element={<AcceptInvitation />} />
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="imports" element={<Imports />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="campaigns/new" element={<CampaignEditor />} />
        <Route path="campaigns/:id/edit" element={<CampaignEditor />} />
        <Route path="campaigns/:id" element={<CampaignDetails />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
