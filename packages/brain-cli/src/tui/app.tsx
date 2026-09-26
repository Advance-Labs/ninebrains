import { Box, useApp, useInput } from 'ink';
import React from 'react';
import { CreateJobForm } from './components/create-job-form';
import { Dashboard } from './components/dashboard';
import { Header } from './components/header';
import { HelpOverlay } from './components/help-overlay';
import { JobsView } from './components/jobs-view';
import { LanesView } from './components/lanes-view';
import { MessagesView } from './components/messages-view';
import { NotesView } from './components/notes-view';
import { SendMessageForm } from './components/send-message-form';
import { StatusBar } from './components/status-bar';
import { useBrainStore } from './store';

export function App() {
  const store = useBrainStore();
  const { exit } = useApp();

  useInput((input, key) => {
    if (store.showHelp) {
      if (input === '?' || key.escape) {
        store.toggleHelp();
      }
      return;
    }

    // Global navigation
    if (input === 'q' && !key.meta) {
      exit();
      return;
    }
    if (input === '?') {
      store.toggleHelp();
      return;
    }
    if (key.escape) {
      if (store.view === 'create-job' || store.view === 'send-message') {
        store.goBack();
      }
      return;
    }

    // View switching (only when not in a form)
    if (store.view !== 'create-job' && store.view !== 'send-message') {
      switch (input) {
        case '1':
          store.setView('dashboard');
          return;
        case '2':
          store.setView('jobs');
          return;
        case '3':
          store.setView('lanes');
          return;
        case '4':
          store.setView('notes');
          return;
        case '5':
          store.setView('messages');
          return;
        case 'n':
          store.setView('create-job');
          return;
        case 's':
          store.setView('send-message');
          return;
        case 'r':
          void store.refresh();
          return;
      }
    }
  });

  const renderView = () => {
    switch (store.view) {
      case 'dashboard':
        return <Dashboard />;
      case 'jobs':
        return <JobsView />;
      case 'lanes':
        return <LanesView />;
      case 'notes':
        return <NotesView />;
      case 'messages':
        return <MessagesView />;
      case 'create-job':
        return <CreateJobForm />;
      case 'send-message':
        return <SendMessageForm />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      <Header />
      <Box flexDirection="column" flexGrow={1}>
        {renderView()}
      </Box>
      <StatusBar />
      {store.showHelp && <HelpOverlay />}
    </Box>
  );
}
