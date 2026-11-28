import { useCallback, useEffect, useState } from 'react';
import { HomePage } from './components/HomePage';
import { PlanView } from './components/PlanView';
import { applyTheme, getInitialTheme, type ThemeMode } from './lib/storage';

function parseRoute(pathname: string): { page: 'home' } | { page: 'plan'; slug: string } {
  const match = pathname.match(/^\/e\/([^/]+)\/?$/);
  if (match && match[1]) {
    try {
      return { page: 'plan', slug: decodeURIComponent(match[1]) };
    } catch {
      return { page: 'home' };
    }
  }
  return { page: 'home' };
}

export function App() {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const handlePop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path);
    setRoute(parseRoute(path));
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  if (route.page === 'plan') {
    return (
      <PlanView
        slug={route.slug}
        onGoHome={() => navigate('/')}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  return (
    <HomePage
      onOpenPlan={(slug) => navigate(`/e/${encodeURIComponent(slug)}`)}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}
