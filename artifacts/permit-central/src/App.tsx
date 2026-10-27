import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, CalendarDays,
  Check, ChevronRight, CircleAlert, ExternalLink, FileSearch, Filter, Hammer, House,
  LoaderCircle, LogOut, MapPin, Plus, RefreshCw, Search, Settings2, ShieldCheck, X,
} from 'lucide-react';
import {
  ClerkProvider, Show, SignIn, SignUp, useClerk, useUser,
} from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  getGetPreferencesQueryKey, useCreateBillingPortal, useCreateCheckout, useGetBillingStatus, useGetDashboardSummary,
  useGetPermit, useGetPreferences, useHealthCheck, useListPermits, useUpdatePreferences,
} from '@workspace/api-client-react';
import type { Permit, Trade } from '@workspace/api-client-react';
import {
  Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useParams,
} from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const trades: Trade[] = ['fence', 'landscaping', 'pool', 'gutters', 'blinds'];
const tradeNames: Record<Trade, string> = {
  fence: 'Fence', landscaping: 'Landscaping', pool: 'Pool', gutters: 'Gutters', blinds: 'Blinds',
};
const tradeDescriptions: Record<Trade, string> = {
  fence: 'Fencing and gates', landscaping: 'Landscape work', pool: 'Pools and spas',
  gutters: 'Gutters and drainage', blinds: 'Window coverings',
};

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: 'top' as const,
    socialButtonsVariant: 'blockButton' as const,
  },
  variables: {
    colorPrimary: '#ad432d',
    colorForeground: '#263a40',
    colorMutedForeground: '#6e7a75',
    colorDanger: '#a13e2d',
    colorBackground: '#faf8f2',
    colorInput: '#fffdf8',
    colorInputForeground: '#263a40',
    colorNeutral: '#ded9cf',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.6rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#faf8f2] rounded-xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#263a40] font-semibold tracking-tight',
    headerSubtitle: 'text-[#6e7a75]',
    socialButtonsBlockButtonText: 'text-[#263a40] font-semibold',
    formFieldLabel: 'text-[#34484a] font-semibold',
    footerActionLink: 'text-[#a6402b] font-semibold',
    footerActionText: 'text-[#6e7a75]',
    dividerText: 'text-[#77817b]',
    identityPreviewEditButton: 'text-[#a6402b]',
    formFieldSuccessText: 'text-[#3f7658]',
    alertText: 'text-[#8a3425]',
    logoBox: 'mb-2',
    logoImage: 'h-9 w-auto',
    socialButtonsBlockButton: 'border-[#ded9cf] bg-[#fffdf8] rounded-lg',
    formButtonPrimary: 'bg-[#ad432d] hover:bg-[#923923] text-[#fff8ec] font-bold',
    formFieldInput: 'bg-[#fffdf8] border-[#d8d2c7] text-[#263a40] rounded-md',
    footerAction: 'mt-2',
    dividerLine: 'bg-[#ded9cf]',
    alert: 'bg-[#fbefea] border-[#e5c4ba]',
    otpCodeFieldInput: 'bg-[#fffdf8] border-[#d8d2c7] text-[#263a40]',
    formFieldRow: 'mb-4',
    main: 'text-[#263a40]',
  },
};

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-mark"><Hammer aria-hidden="true" /></span>
      {!compact && <span>Permit Central</span>}
    </span>
  );
}

function Header() {
  const { user } = useUser();
  const { signOut } = useClerk();
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="Permit Central home"><Brand /></Link>
      <div className="topbar-right">
        {user && <span className="user-tag" data-testid="text-account-email">{user.primaryEmailAddress?.emailAddress}</span>}
        <Show when="signed-in">
          <button className="button button-quiet" type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out">
            <LogOut aria-hidden="true" /> <span className="signout-label">Sign out</span>
          </button>
        </Show>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <Brand />
      <span>Local building permits, in one practical place.</span>
    </footer>
  );
}

function LandingPage() {
  return (
    <main className="landing">
      <section className="landing-hero">
        <div>
          <p className="eyebrow">Chicago-area permit leads</p>
          <h1 className="hero-title">Find the work<br />before it <em>starts.</em></h1>
          <p className="hero-copy">A clear view of new local building permits, matched to your trade and the ZIP codes you serve. Spend less time searching. Get to the right job sooner.</p>
          <div className="hero-actions">
            <Link href="/sign-up" className="button button-primary" data-testid="link-get-started">Get started <ArrowRight aria-hidden="true" /></Link>
            <Link href="/sign-in" className="button button-outline" data-testid="link-sign-in">Sign in</Link>
          </div>
          <div className="hero-note"><ShieldCheck aria-hidden="true" /> Permit records from local public sources</div>
        </div>
        <div className="permit-art" aria-label="Illustrated building permit blueprint">
          <div className="blueprint">
            <div className="blueprint-kicker"><span>Permit Central / 01</span><span>Cook County</span></div>
            <h2 className="blueprint-title">Permit activity</h2>
            <p className="blueprint-line">RESIDENTIAL IMPROVEMENT · LOCAL RECORD</p>
            <div className="plan">
              <svg viewBox="0 0 270 220" fill="none" aria-hidden="true">
                <path d="M35 38h195v131H35zM72 38v47h67V38m0 47h91M35 123h37v46m67-84v84m0-58h91m-91 58h91M72 85v38m-37 0h37" stroke="#e4d8b5" strokeWidth="2"/>
                <path d="M47 51h13v25H47zm37 0h37v25H84zm73 0h60v25h-60zm-38 48h13v12h-13zm-38 35h25v25H81zm73-12h60v12h-60z" stroke="#d9a98a" strokeWidth="1.4"/>
                <circle cx="221" cy="35" r="5" fill="#d9a98a"/>
                <path d="M222 30v-13m-5 0h10" stroke="#d9a98a" strokeWidth="1.5"/>
              </svg>
            </div>
            <span className="plan-caption">FIELD NOTES / CHICAGO</span>
          </div>
          <div className="hero-stamp">LOCAL<br />RECORDS<br />AT A GLANCE</div>
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <h2>From permit filing to your next conversation.</h2>
          <p>Permit Central turns public records into a straightforward daily workflow for independent contractors and local crews.</p>
        </div>
        <div className="steps">
          <article className="step"><span className="step-number">01 / SET YOUR PATCH</span><h3>Pick your trades and ZIPs</h3><p>Tell us the work you take on and the neighborhoods you cover. Your matches stay relevant.</p></article>
          <article className="step"><span className="step-number">02 / SEE THE SIGNAL</span><h3>Scan recent permits</h3><p>Review new filings with the address, scope, dates, and reported project cost in one view.</p></article>
          <article className="step"><span className="step-number">03 / MAKE THE MOVE</span><h3>Follow up with context</h3><p>Open the source record and understand the project before you reach out.</p></article>
        </div>
      </section>
      <section className="sample-section">
        <div className="section-heading">
          <h2>Local work leaves a paper trail.</h2>
          <p>Stay close to the filings that matter to your crew, without sifting through a city portal all morning.</p>
        </div>
        <div className="sample-line"><div><div className="sample-address">Permit activity, matched to your work</div><div className="sample-meta">Trade-specific leads · selected ZIP codes · source links</div></div><span className="trade-pill">Chicago area</span></div>
        <div className="sample-line"><div><div className="sample-address">Daily digest, on your schedule</div><div className="sample-meta">A concise email when new matching permits are reported</div></div><span className="trade-pill">Optional</span></div>
        <div className="sample-line"><div><div className="sample-address">One predictable subscription</div><div className="sample-meta">Full local lead access for $99 per month</div></div><span className="trade-pill">$99 / month</span></div>
      </section>
      <section className="cta-strip">
        <h2>Start with the ZIP codes you know.</h2>
        <Link href="/sign-up" className="button button-dark" data-testid="link-join-permit-central">Create your account <ArrowUpRight aria-hidden="true" /></Link>
      </section>
      <Footer />
    </main>
  );
}

function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><LandingPage /></Show></>;
}

function SignedIn({ children }: { children: ReactNode }) {
  return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}

function DashboardLayout({ children, active }: { children: ReactNode; active: 'dashboard' | 'settings' }) {
  const { user } = useUser();
  const health = useHealthCheck();
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const initials = email.slice(0, 1).toUpperCase() || 'C';
  return (
    <div className="app-shell">
      <Header />
      <div className="dashboard-frame">
        <aside className="sidebar">
          <p className="side-label">Workspace</p>
          <Link href="/dashboard" className={`side-link ${active === 'dashboard' ? 'active' : ''}`} data-testid="nav-dashboard"><House /> Overview</Link>
          <Link href="/settings" className={`side-link ${active === 'settings' ? 'active' : ''}`} data-testid="nav-settings"><Settings2 /> Preferences</Link>
          <div className="side-bottom">
            <div className="profile-head">
              <span className="avatar-mark" data-testid="text-account-initial">{initials}</span>
              <div><div className="profile-name">Your account</div><div className="profile-email">{email}</div></div>
            </div>
            <div style={{ marginTop: 15, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: health.isError ? '#ad432d' : '#477654' }} />
              {health.isLoading ? 'Checking service' : health.isError ? 'Service connection unavailable' : `Permit service ${health.data?.status ?? 'available'}`}
            </div>
          </div>
        </aside>
        <main className="main-content">{children}</main>
      </div>
      <nav className="mobile-nav" aria-label="Main navigation">
        <Link href="/dashboard" className={active === 'dashboard' ? 'active' : ''} data-testid="mobile-nav-dashboard"><House />Dashboard</Link>
        <Link href="/settings" className={active === 'settings' ? 'active' : ''} data-testid="mobile-nav-settings"><Settings2 />Preferences</Link>
      </nav>
    </div>
  );
}

function LoadingPanel({ rows = 3 }: { rows?: number }) {
  return <div className="permit-list" aria-label="Loading permits" data-testid="loading-permits">{Array.from({ length: rows }, (_, index) => <div key={index} style={{ padding: '15px 0', borderBottom: '1px solid #e9e4da' }}><div className="skeleton skeleton-line" style={{ width: '58%' }} /><div className="skeleton skeleton-line" style={{ width: '34%' }} /></div>)}</div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="error-state" role="alert"><div><strong>Could not load this information</strong><p>{message}</p></div><button className="button button-outline" type="button" onClick={onRetry} data-testid="button-retry"><RefreshCw />Try again</button></div>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="state-box" data-testid="status-empty"><FileSearch className="state-icon" aria-hidden="true" /><strong>{title}</strong><p>{body}</p></div>;
}

function formatDate(value?: string | null) {
  if (!value) return 'Not reported';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function money(value?: number | null) {
  if (value == null) return 'Not reported';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function PermitRow({ permit, matching = false }: { permit: Permit; matching?: boolean }) {
  const matchingTrades = permit.trades ?? [];
  return (
    <Link href={`/permits/${encodeURIComponent(permit.permitNumber)}`} className="permit-row" data-testid={`permit-row-${permit.permitNumber}`}>
      <div>
        <div className="permit-row-title"><span className="permit-row-address">{permit.address}</span><span className="permit-no">#{permit.permitNumber}</span></div>
        <div className="permit-row-meta">{permit.permitType} · {permit.zipCode || 'ZIP not listed'} · {formatDate(permit.issueDate || permit.applicationDate)}</div>
        <div className="match-trades" style={{ marginTop: 8 }}>{matchingTrades.slice(0, 3).map(trade => <span className="trade-pill" key={trade}>{tradeNames[trade]}</span>)}</div>
      </div>
      <div className="row-right"><span className="row-date">{permit.status || 'Status not reported'}</span>{matching && <span className="match-badge">Your trade</span>}<ChevronRight size={16} aria-hidden="true" /></div>
    </Link>
  );
}

function DashboardPage() {
  const [search, setSearch] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [trade, setTrade] = useState('');
  const params = useMemo(() => ({
    ...(search.trim() ? { q: search.trim() } : {}),
    ...(zipCode ? { zipCode } : {}),
    ...(trade ? { trade: trade as Trade } : {}),
    days: 30,
    limit: 30,
    offset: 0,
  }), [search, zipCode, trade]);
  const billing = useGetBillingStatus();
  const summary = useGetDashboardSummary();
  const preferences = useGetPreferences();
  const permits = useListPermits(params);
  const matches = useMemo(() => {
    const preference = preferences.data;
    return (permits.data?.items ?? []).filter(permit => {
      const tradeMatch = !preference?.trades?.length || permit.trades.some(item => preference.trades.includes(item));
      const zipMatch = !preference?.zipCodes?.length || (permit.zipCode != null && preference.zipCodes.includes(permit.zipCode));
      return tradeMatch && zipMatch;
    });
  }, [permits.data?.items, preferences.data?.trades, preferences.data?.zipCodes]);

  return (
    <DashboardLayout active="dashboard">
      <div className="page-heading">
        <div><p className="eyebrow">Your local permit desk</p><h1>Good morning.</h1><p>Recent permit activity around the Chicago area.</p></div>
        <div className="sync-stamp"><CalendarDays aria-hidden="true" /> Updated {summary.data?.lastSyncAt ? formatDate(summary.data.lastSyncAt) : 'when available'}</div>
      </div>
      {billing.isLoading ? <LoadingPanel /> : billing.isError ? <ErrorState message="Your subscription status could not be checked." onRetry={() => { void billing.refetch(); }} /> : !billing.data?.active ? (
        <section className="panel settings-panel" style={{ maxWidth: 680 }}>
          <p className="eyebrow">Subscriber access</p>
          <h2>Unlock your local permit desk.</h2>
          <p>Choose the trades and ZIP codes you serve, then start your $99 monthly plan to browse matching permit leads.</p>
          <SubscriptionCard />
        </section>
      ) : <>
      {summary.isError && <ErrorState message="Your dashboard summary did not load." onRetry={() => { void summary.refetch(); }} />}
      <div className="metric-grid">
        <div className="metric"><div className="metric-label">New permits today</div><div className="metric-value" data-testid="value-new-permits">{summary.isLoading ? '—' : summary.data?.newPermitsToday ?? '—'}</div><div className="metric-sub">Reported in the latest feed</div></div>
        <div className="metric"><div className="metric-label">Matching your work</div><div className="metric-value" data-testid="value-matching-permits">{summary.isLoading ? '—' : summary.data?.matchingPermits ?? '—'}</div><div className="metric-sub">Based on your saved trades and ZIPs</div></div>
        <div className="metric"><div className="metric-label">Recent permits</div><div className="metric-value" data-testid="value-recent-permits">{summary.isLoading ? '—' : summary.data?.recentPermits ?? '—'}</div><div className="metric-sub">Available in the recent record window</div></div>
      </div>
      <div className="dashboard-content-grid">
        <section className="panel">
          <div className="panel-head">
            <div><h2 className="panel-title">Recent permits</h2><p className="panel-subtitle">{permits.data ? `${permits.data.total} records available` : 'Browse the latest public records'}</p></div>
            <Filter size={17} color="#9e4a35" aria-hidden="true" />
          </div>
          <div className="filters">
            <label className="sr-only" htmlFor="permit-search">Search permit records</label>
            <div style={{ position: 'relative', flex: '1 1 170px' }}><Search size={15} style={{ position: 'absolute', top: 12, left: 10, color: '#818b85' }} aria-hidden="true" /><input id="permit-search" className="field search-field" style={{ width: '100%', paddingLeft: 32 }} value={search} onChange={event => setSearch(event.target.value)} placeholder="Address or keyword" data-testid="input-permit-search" /></div>
            <label className="sr-only" htmlFor="filter-trade">Filter by trade</label>
            <select id="filter-trade" className="field" value={trade} onChange={event => setTrade(event.target.value)} data-testid="select-trade-filter"><option value="">All trades</option>{trades.map(item => <option key={item} value={item}>{tradeNames[item]}</option>)}</select>
            <label className="sr-only" htmlFor="filter-zip">Filter by ZIP code</label>
            <input id="filter-zip" className="field" style={{ width: 100 }} value={zipCode} onChange={event => setZipCode(event.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="ZIP code" inputMode="numeric" data-testid="input-zip-filter" />
          </div>
          {permits.isLoading ? <LoadingPanel /> : permits.isError ? <ErrorState message="The permit list could not be retrieved." onRetry={() => { void permits.refetch(); }} /> : permits.data?.items?.length ? <div className="permit-list">{permits.data.items.map(permit => <PermitRow key={permit.permitNumber} permit={permit} matching={matches.some(item => item.permitNumber === permit.permitNumber)} />)}</div> : <EmptyState title="No permits found" body="Try a broader search, clear a filter, or check back after the next public-record sync." />}
        </section>
        <aside className="aside-stack">
          <section className="match-card"><h2>Matched to your patch</h2><p>Permits aligned with the trades and ZIP codes on your account.</p>{preferences.isLoading ? <div className="skeleton skeleton-line" /> : preferences.isError ? <p>Preferences could not be loaded. Visit settings to retry.</p> : preferences.data?.trades?.length ? <div className="match-trades">{preferences.data.trades.map(item => <span className="trade-pill" key={item}>{tradeNames[item]}</span>)}</div> : <Link href="/settings" className="button button-outline" data-testid="link-set-trades">Choose your trades <ArrowRight /></Link>}<div style={{ marginTop: 16, paddingTop: 13, borderTop: '1px solid #ffffff2e', fontSize: 11, color: '#c5d0c7' }}>Showing {matches.length} matches in the current list</div></section>
          <section className="panel profile-card"><div className="profile-head"><span className="avatar-mark"><BadgeCheck /></span><div><div className="profile-name">Daily permit digest</div><div className="profile-email">{preferences.isLoading ? 'Loading preferences' : preferences.data?.digestEnabled ? 'Email updates are on' : 'Email updates are off'}</div></div></div><div className="profile-action"><span>{preferences.data?.email ?? 'Account email'}</span><Link href="/settings" data-testid="link-edit-digest">Edit</Link></div></section>
          <SubscriptionCard compact />
        </aside>
      </div>
      </>}
    </DashboardLayout>
  );
}

function SubscriptionCard({ compact = false }: { compact?: boolean }) {
  const billing = useGetBillingStatus();
  const preferences = useGetPreferences();
  const checkout = useCreateCheckout();
  const portal = useCreateBillingPortal();
  const [actionError, setActionError] = useState('');
  const busy = checkout.isPending || portal.isPending;
  const active = billing.data?.active ?? false;
  function startCheckout() {
    setActionError('');
    checkout.mutate(undefined, { onSuccess: result => { window.location.assign(result.url); }, onError: () => setActionError('Checkout could not be started. Try again shortly.') });
  }
  function openPortal() {
    setActionError('');
    portal.mutate(undefined, { onSuccess: result => { window.location.assign(result.url); }, onError: () => setActionError('The billing portal could not be opened. Try again shortly.') });
  }
  return (
    <section className={`panel sub-card ${compact ? 'compact' : ''}`}>
      <div className="sub-status"><strong>Subscription</strong>{billing.isLoading ? <span className="skeleton" style={{ width: 58, height: 19 }} /> : billing.data && <span className="status-chip">{billing.data.status.replace('_', ' ')}</span>}</div>
      {billing.isError ? <><p>Subscription details are unavailable right now.</p><button className="button button-outline" type="button" onClick={() => { void billing.refetch(); }} data-testid="button-retry-billing">Retry</button></> : <>
        <div className="billing-price"><strong>$99</strong><span>/ month</span></div>
        <p>{active ? billing.data?.cancelAtPeriodEnd ? `Access continues through ${formatDate(billing.data.currentPeriodEnd)}.` : `Your plan renews ${formatDate(billing.data?.currentPeriodEnd)}.` : 'Permit discovery for your local service area.'}</p>
        {!compact && <ul className="billing-list"><li>Trade and ZIP-code matching</li><li>Recent permit records</li><li>Optional daily email digest</li></ul>}
        {active ? <button type="button" className="button button-outline" onClick={openPortal} disabled={busy} data-testid="button-billing-portal">{portal.isPending ? <LoaderCircle className="spin" /> : <ExternalLink />}Manage subscription</button> : preferences.data?.trades?.length && preferences.data?.zipCodes?.length ? <button type="button" className="button button-primary" onClick={startCheckout} disabled={busy} data-testid="button-start-checkout">{checkout.isPending ? <LoaderCircle className="spin" /> : <ArrowRight />}Start subscription</button> : <Link href="/settings" className="button button-primary" data-testid="link-subscription-setup"><ArrowRight />Choose trades and ZIPs</Link>}
      </>}
      {actionError && <p className="save-error" role="alert">{actionError}</p>}
    </section>
  );
}

function PermitDetailPage() {
  const { permitNumber = '' } = useParams<{ permitNumber: string }>();
  const permit = useGetPermit(decodeURIComponent(permitNumber));
  const item = permit.data;
  return (
    <DashboardLayout active="dashboard">
      <Link href="/dashboard" className="detail-back" data-testid="link-back-dashboard"><ArrowLeft /> Back to permits</Link>
      {permit.isLoading ? <section className="panel" style={{ padding: 22 }}><div className="skeleton skeleton-block" /><div className="skeleton skeleton-line" style={{ width: '65%', marginTop: 20 }} /><div className="skeleton skeleton-line" style={{ width: '35%' }} /></section> : permit.isError || !item ? <ErrorState message="This permit record could not be loaded." onRetry={() => { void permit.refetch(); }} /> : <>
        <section className="detail-hero">
          <div className="detail-topline"><span className="eyebrow">Permit record</span><span className="detail-number">#{item.permitNumber}</span></div>
          <h1>{item.permitType}</h1>
          <p><MapPin size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} aria-hidden="true" />{item.address}{item.zipCode ? `, Chicago, IL ${item.zipCode}` : ', Chicago area'}</p>
        </section>
        <div className="detail-grid">
          <section className="panel detail-section">
            <h2>Project information</h2>
            <div className="detail-pairs">
              <DetailPair label="Status" value={item.status || 'Not reported'} />
              <DetailPair label="Reported cost" value={money(item.reportedCost)} />
              <DetailPair label="Issue date" value={formatDate(item.issueDate)} />
              <DetailPair label="Application date" value={formatDate(item.applicationDate)} />
              <DetailPair label="Permit number" value={item.permitNumber} />
              <DetailPair label="ZIP code" value={item.zipCode || 'Not listed'} />
            </div>
          </section>
          <section className="panel detail-section">
            <h2>Potential trade fit</h2>
            {item.trades.length ? <div className="match-trades">{item.trades.map(itemTrade => <span className="trade-pill" key={itemTrade}>{tradeNames[itemTrade]}</span>)}</div> : <p className="description">No trade tags are listed for this permit.</p>}
            <a className="link source-link" href={item.sourceUrl} target="_blank" rel="noreferrer" data-testid="link-source-record">View public source record <ExternalLink /></a>
          </section>
          <section className="panel detail-section" style={{ gridColumn: '1 / -1' }}>
            <h2>Project description</h2>
            <p className="description">{item.description || 'No description was included in the public record.'}</p>
          </section>
        </div>
      </>}
    </DashboardLayout>
  );
}

function DetailPair({ label, value }: { label: string; value: string }) {
  return <div><div className="detail-key">{label}</div><div className="detail-value" data-testid={`detail-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</div></div>;
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const preferences = useGetPreferences();
  const update = useUpdatePreferences();
  const [selectedTrades, setSelectedTrades] = useState<Trade[]>([]);
  const [zipCodes, setZipCodes] = useState<string[]>([]);
  const [zipDraft, setZipDraft] = useState('');
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const initialized = useRef(false);
  useEffect(() => {
    if (preferences.data && !initialized.current) {
      setSelectedTrades(preferences.data.trades);
      setZipCodes(preferences.data.zipCodes);
      setDigestEnabled(preferences.data.digestEnabled);
      initialized.current = true;
    }
  }, [preferences.data]);
  function toggleTrade(item: Trade) {
    setSelectedTrades(current => current.includes(item) ? current.filter(trade => trade !== item) : [...current, item]);
    setSaveMessage('');
  }
  function addZip() {
    const zip = zipDraft.trim();
    if (!/^\d{5}$/.test(zip)) { setSaveError('Enter a five-digit ZIP code.'); return; }
    if (zipCodes.includes(zip)) { setSaveError('That ZIP code is already included.'); return; }
    if (zipCodes.length >= 10) { setSaveError('You can save up to 10 ZIP codes.'); return; }
    setZipCodes(current => [...current, zip]);
    setZipDraft('');
    setSaveError('');
    setSaveMessage('');
  }
  function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveMessage('');
    setSaveError('');
    if (!selectedTrades.length) { setSaveError('Choose at least one trade.'); return; }
    if (!zipCodes.length) { setSaveError('Add at least one ZIP code.'); return; }
    update.mutate({ data: { trades: selectedTrades, zipCodes, digestEnabled } }, {
      onSuccess: saved => { queryClient.setQueryData(getGetPreferencesQueryKey(), saved); setSaveMessage('Your preferences are saved.'); },
      onError: () => { setSaveError('Preferences could not be saved. Please try again.'); },
    });
  }
  const addZipFromKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); addZip(); }
  };
  return (
    <DashboardLayout active="settings">
      <div className="page-heading"><div><p className="eyebrow">Account setup</p><h1>Your preferences.</h1><p>Keep your permit feed focused on the work you take on.</p></div></div>
      {preferences.isLoading ? <div className="settings-columns"><section className="panel settings-panel"><div className="skeleton skeleton-line" style={{ width: '42%' }} /><div className="skeleton skeleton-block" style={{ marginTop: 24 }} /></section></div> : preferences.isError ? <ErrorState message="Your account preferences could not be loaded." onRetry={() => { void preferences.refetch(); }} /> : <>
        <div className="settings-columns">
          <form onSubmit={savePreferences}>
            <section className="panel settings-panel">
              <h2>Work area</h2><p>Choose the work you want to spot and the ZIP codes where you operate.</p>
              <label className="setting-label">Account email</label>
              <div className="account-email" data-testid="text-settings-email">{preferences.data?.email}</div>
              <span className="setting-label">Trades</span>
              <div className="trade-grid">{trades.map(item => <label className={`trade-option ${selectedTrades.includes(item) ? 'selected' : ''}`} key={item} data-testid={`option-trade-${item}`}><input type="checkbox" data-testid={`checkbox-trade-${item}`} checked={selectedTrades.includes(item)} onChange={() => toggleTrade(item)} /><span>{tradeNames[item]}</span></label>)}</div>
              <div className="setting-label">Service ZIP codes <span style={{ color: '#7c8781', fontWeight: 400 }}>({zipCodes.length}/10)</span></div>
              <div className="zip-entry"><input className="field" value={zipDraft} onChange={event => setZipDraft(event.target.value.replace(/\D/g, '').slice(0, 5))} onKeyDown={addZipFromKey} placeholder="Enter a 5-digit ZIP" inputMode="numeric" aria-label="Add service ZIP code" data-testid="input-service-zip" /><button className="button button-outline" type="button" onClick={addZip} disabled={zipCodes.length >= 10} data-testid="button-add-zip"><Plus />Add</button></div>
              <div className="zip-list">{zipCodes.map(zip => <span className="zip-chip" key={zip}>{zip}<button type="button" aria-label={`Remove ZIP ${zip}`} onClick={() => { setZipCodes(current => current.filter(code => code !== zip)); setSaveMessage(''); }} data-testid={`button-remove-zip-${zip}`}><X /></button></span>)}</div>
              {!zipCodes.length && <p style={{ color: '#9c4933', fontSize: 12 }}>Add at least one service ZIP to save preferences.</p>}
              <div className="save-row"><button type="submit" className="button button-primary" disabled={update.isPending} data-testid="button-save-preferences">{update.isPending ? <LoaderCircle className="spin" /> : <Check />}Save preferences</button>{saveMessage && <span className="save-message" role="status" data-testid="status-preferences-saved">{saveMessage}</span>}{saveError && <span className="save-error" role="alert" data-testid="status-preferences-error">{saveError}</span>}</div>
            </section>
          </form>
          <div>
            <section className="panel settings-panel">
              <h2>Email digest</h2><p>Get a daily email when new permits match your service area.</p>
              <div className="toggle-row"><div><h3>Daily matching permits</h3><p>Sent to {preferences.data?.email}</p></div><button className={`switch ${digestEnabled ? 'on' : ''}`} type="button" role="switch" aria-checked={digestEnabled} aria-label="Daily email digest" onClick={() => { setDigestEnabled(value => !value); setSaveMessage(''); }} data-testid="switch-daily-digest" /></div>
              <p style={{ marginBottom: 0 }}>Save preferences to apply your digest selection.</p>
            </section>
            <SubscriptionCard />
          </div>
        </div>
      </>}
    </DashboardLayout>
  );
}

function SignInPage() {
  return <div className="auth-wrap"><div className="auth-inner"><div className="auth-brand"><Link href="/" aria-label="Permit Central home"><Brand /></Link></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>;
}

function SignUpPage() {
  return <div className="auth-wrap"><div className="auth-inner"><div className="auth-brand"><Link href="/" aria-label="Permit Central home"><Brand /></Link></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></div>;
}

function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUser.current !== undefined && previousUser.current !== userId) client.clear();
      previousUser.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}

function RouterRoutes() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/dashboard"><SignedIn><DashboardPage /></SignedIn></Route>
      <Route path="/settings"><SignedIn><SettingsPage /></SignedIn></Route>
      <Route path="/permits/:permitNumber"><SignedIn><PermitDetailPage /></SignedIn></Route>
      <Route><main className="app-shell"><Header /><div className="state-box" style={{ maxWidth: 560, margin: '12vh auto' }}><CircleAlert className="state-icon" /><strong>That page is not here</strong><p>Head back to your permit desk and keep looking.</p><Link href="/dashboard" className="button button-primary" style={{ marginTop: 18 }} data-testid="link-not-found-dashboard">Go to dashboard <ArrowRight /></Link></div><Footer /></main></Route>
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to see local permit leads.' } },
        signUp: { start: { title: 'Make room for more work', subtitle: 'Set your service area and see matching permits.' } },
      }}
      routerPush={to => setLocation(stripBase(to))}
      routerReplace={to => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkCacheInvalidator />
        <RouterRoutes />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>;
}

export default App;
