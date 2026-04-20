import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/Layout';
import AgentListPage from './page/AgentListPage';
import AgentDetailPage from './page/AgentDetailPage';
import EvalListPage from './page/EvalListPage';
import EvalNewPage from './page/EvalNewPage';
import EvalProgressPage from './page/EvalProgressPage';
import EvalResultsPage from './page/EvalResultsPage';
import EvalSamplesPage from './page/EvalSamplesPage';
import ReportListPage from './page/ReportListPage';
import ReportDetailPage from './page/ReportDetailPage';
import NotFoundPage from './page/NotFoundPage';

const App: React.FC = () => {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/agents" replace />} />
        <Route path="/agents" element={<AgentListPage />} />
        <Route path="/agents/:id" element={<AgentDetailPage />} />
        <Route path="/eval" element={<EvalListPage />} />
        <Route path="/eval/new" element={<EvalNewPage />} />
        <Route path="/eval/progress/:id" element={<EvalProgressPage />} />
        <Route path="/eval/results/:jobId" element={<EvalResultsPage />} />
        <Route path="/eval/results/:jobId/samples/:taskId" element={<EvalSamplesPage />} />
        <Route path="/reports" element={<ReportListPage />} />
        <Route path="/reports/:id" element={<ReportDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
};

export default App;
