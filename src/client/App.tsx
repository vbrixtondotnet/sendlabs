import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Overview } from "@/pages/Overview";
import { Imports } from "@/pages/Imports";
import { Jobs } from "@/pages/Jobs";
import { People } from "@/pages/People";
import { Contacts } from "@/pages/Contacts";
import { Campaigns } from "@/pages/Campaigns";
import { CampaignEditor } from "@/pages/CampaignEditor";
import { CampaignDetails } from "@/pages/CampaignDetails";
import { Settings } from "@/pages/Settings";
import { EmailTemplates } from "@/pages/EmailTemplates";
import { Login } from "@/pages/Login";
import { Unsubscribe } from "@/pages/Unsubscribe";
import { MySettings } from "@/pages/MySettings";
import { UserAccounts } from "@/pages/UserAccounts";

export function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="unsubscribe/:token" element={<Unsubscribe />} />
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="users" element={<UserAccounts />} />
        <Route path="imports" element={<Imports />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="people" element={<People />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="campaigns/new" element={<CampaignEditor />} />
        <Route path="campaigns/:id/edit" element={<CampaignEditor />} />
        <Route path="campaigns/:id" element={<CampaignDetails />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="templates" element={<EmailTemplates />} />
        <Route path="settings" element={<Settings />} />
        <Route path="account" element={<MySettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
