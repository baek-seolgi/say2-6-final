import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import MonitorPage from "./pages/MonitorPage";
import DashboardPage from "./pages/DashboardPage";
import ArchivePage from "./pages/ArchivePage";
import TriagePage from "./pages/TriagePage";

// EMR 툴바 라우팅 — 각 아이콘별 페이지
import PatientSearchPage from "./pages/PatientSearchPage";
import NotesPage from "./pages/NotesPage";
import RecordsPage from "./pages/RecordsPage";
import LabQueuePage from "./pages/LabQueuePage";
import ImagingQueuePage from "./pages/ImagingQueuePage";
import PrescriptionPage from "./pages/PrescriptionPage";
import ConsultPage from "./pages/ConsultPage";
import PatientCallPage from "./pages/PatientCallPage";
import StatsPage from "./pages/StatsPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<MonitorPage />} />
          <Route path="/triage" element={<TriagePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/archive" element={<ArchivePage />} />

          {/* Group A — 환자 라이프사이클 */}
          <Route path="/patients" element={<PatientSearchPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/records/:mrn" element={<RecordsPage />} />

          {/* Group B — 검사·처방 큐 */}
          <Route path="/lab-queue" element={<LabQueuePage />} />
          <Route path="/imaging-queue" element={<ImagingQueuePage />} />
          <Route path="/prescriptions" element={<PrescriptionPage />} />

          {/* Group C — 협업·통계 */}
          <Route path="/consult" element={<ConsultPage />} />
          <Route path="/call" element={<PatientCallPage />} />
          <Route path="/stats" element={<StatsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
