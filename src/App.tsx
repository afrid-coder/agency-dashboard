import { createBrowserRouter, RouterProvider } from 'react-router';
import { lazy, Suspense } from 'react';
import { ToastProvider } from './components/Toast.tsx';
import { Gate } from './features/auth/Gate.tsx';
import { ShellLoading } from './features/shell/ShellLoading.tsx';
import { NotFoundPage } from './features/shell/NotFoundPage.tsx';
import { SignInPage } from './features/auth/SignInPage.tsx';
import { SignUpPage } from './features/auth/SignUpPage.tsx';
import { CheckEmailPage } from './features/auth/CheckEmailPage.tsx';
import { ForgotPasswordPage, ResetPasswordPage } from './features/auth/PasswordResetPages.tsx';
import { InvitePage } from './features/auth/InvitePage.tsx';
import { OnboardingPage } from './features/auth/OnboardingPage.tsx';
import { PendingPage } from './features/auth/PendingPage.tsx';
import { DevOutboxPage } from './features/auth/DevOutboxPage.tsx';
import type { ComponentType } from 'react';

// The workspace loads separately from the public and account pages.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType<never>>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
const AppShell = lazy(() => import('./features/shell/AppShell.tsx').then((m) => ({ default: m.AppShell })));
const DashboardPage = page(() => import('./features/dashboard/DashboardPage.tsx'), 'DashboardPage');
const CalendarPage = page(() => import('./features/calendar/CalendarPage.tsx'), 'CalendarPage');
const TasksPage = page(() => import('./features/tasks/TasksPage.tsx'), 'TasksPage');
const ProjectsPage = page(() => import('./features/projects/ProjectsPage.tsx'), 'ProjectsPage');
const ProjectPage = page(() => import('./features/projects/ProjectPage.tsx'), 'ProjectPage');
const ClientsPage = page(() => import('./features/clients/ClientsPage.tsx'), 'ClientsPage');
const NotesPage = page(() => import('./features/notes/NotesPage.tsx'), 'NotesPage');
const ProfitPage = page(() => import('./features/profit/ProfitPage.tsx'), 'ProfitPage');
const SettingsPage = page(() => import('./features/settings/SettingsPage.tsx'), 'SettingsPage');

// The public front page carries its own motion stack (Lenis + ScrollTrigger); load it separately.
const LandingPage = lazy(() => import('./features/landing/LandingPage.tsx'));

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<ShellLoading />}>
        <LandingPage />
      </Suspense>
    ),
  },
  { path: '/signin', element: <SignInPage /> },
  { path: '/signup', element: <SignUpPage /> },
  { path: '/check-email', element: <CheckEmailPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/invite/:token', element: <InvitePage /> },
  { path: '/dev/outbox', element: <DevOutboxPage /> },
  { path: '/onboarding', element: <Gate need="user">{(me) => <OnboardingPage me={me} />}</Gate> },
  { path: '/pending', element: <Gate need="user">{(me) => <PendingPage me={me} />}</Gate> },
  {
    path: '/app',
    element: (
      <Gate need="workspace">
        {(me) => (
          <Suspense fallback={<ShellLoading />}>
            <AppShell me={me} />
          </Suspense>
        )}
      </Gate>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'calendar', element: <CalendarPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'notes', element: <NotesPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:id', element: <ProjectPage /> },
      { path: 'clients', element: <ClientsPage /> },
      { path: 'profit', element: <ProfitPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'settings/:tab', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' });

export function App() {
  return (
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  );
}
