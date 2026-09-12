import { createContext, useContext } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api/client';
import type { AppConfig } from './api/types';
import { Badge, ErrorState, Loading } from './components/ui';
import { useAsync } from './hooks';
import { AttemptPage } from './pages/AttemptPage';
import { HistoryPage } from './pages/HistoryPage';
import { ProblemDetailPage } from './pages/ProblemDetailPage';
import { ProblemLibraryPage } from './pages/ProblemLibraryPage';

/**
 * The rubric and the submission schema are served by the API, not duplicated
 * here: the form, the pre-submit checklist and the feedback screen all render
 * from the same definitions the evaluator is scored against.
 */
const ConfigContext = createContext<AppConfig | null>(null);

export function useConfig(): AppConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error('useConfig must be used inside <App />');
  return config;
}

export default function App() {
  const { data: config, error, loading, reload } = useAsync(() => api.config(), []);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="mark">LLD</span>
          <span>Practice</span>
        </Link>
        <nav>
          <NavLink to="/" end>
            Problems
          </NavLink>
          <NavLink to="/history">History</NavLink>
          {config && (
            <Badge tone={config.evaluation.isDemo ? 'warn' : 'accent'}>
              {config.evaluation.isDemo ? 'Demo evaluator' : 'AI evaluator'}
            </Badge>
          )}
        </nav>
      </header>

      {loading && <Loading label="Starting up…" />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}

      {config && (
        <ConfigContext.Provider value={config}>
          <Routes>
            <Route path="/" element={<ProblemLibraryPage />} />
            <Route path="/problems/:problemId" element={<ProblemDetailPage />} />
            <Route path="/attempts/:attemptId" element={<AttemptPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ConfigContext.Provider>
      )}
    </div>
  );
}
