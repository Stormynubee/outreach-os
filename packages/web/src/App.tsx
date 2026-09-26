import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, Route, Router, Switch } from 'wouter';

import { EmptyState } from './components/EmptyState';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Guide } from './components/Guide';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { Splash } from './components/Splash';
import { IconCompass } from './components/icons';
import { hasSeenGuide, markGuideSeen } from './lib/prefs';
import Discover from './pages/Discover';
import Home from './pages/Home';
import LeadDetail from './pages/LeadDetail';
import Leads from './pages/Leads';
import Outreach from './pages/Outreach';
import SettingsPage from './pages/Settings';

function NotFound(): ReactElement {
  return (
    <EmptyState
      title="That page does not exist"
      body="Use the navigation above to get back to work."
      action={
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-pill bg-ink px-4 py-2 text-[13px] font-bold text-white"
        >
          <IconCompass className="h-4 w-4" />
          Go to the dashboard
        </Link>
      }
    />
  );
}

/** Splash + guide state lives here so both the header and footer can open the guide. */
function Shell(): ReactElement {
  const [splashDone, setSplashDone] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const finishSplash = useCallback(() => setSplashDone(true), []);
  const openGuide = useCallback(() => setGuideOpen(true), []);
  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    markGuideSeen();
  }, []);

  // Show the tour once, on a first visit, after the splash has cleared. The guide
  // icon stays in the header afterwards, so it is never more than one click away.
  useEffect(() => {
    if (!splashDone || hasSeenGuide()) return;
    const timer = window.setTimeout(() => setGuideOpen(true), 500);
    return () => window.clearTimeout(timer);
  }, [splashDone]);

  return (
    <>
      {!splashDone ? <Splash onDone={finishSplash} /> : null}

      {/* Website shell: full-width sticky header, wide content container, footer. */}
      <div className="flex min-h-dvh flex-col bg-page">
        <SiteHeader onOpenGuide={openGuide} />
        <main className="shell flex-1 pt-8 pb-16 lg:pt-10">
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/discover" component={Discover} />
            <Route path="/leads" component={Leads} />
            <Route path="/leads/:id" component={LeadDetail} />
            <Route path="/outreach" component={Outreach} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </main>
        <SiteFooter onOpenGuide={openGuide} />
      </div>

      <Guide open={guideOpen} onClose={closeGuide} />
    </>
  );
}

export default function App(): ReactElement {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 10_000,
            gcTime: 5 * 60_000,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <Router>
          <Shell />
        </Router>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
