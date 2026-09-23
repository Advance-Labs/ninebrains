import { toast } from '@emdash/ui/react/primitives';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { MonacoBinding } from 'y-monaco';
import * as Y from 'yjs';
import { openFileStore } from '@core/features/editor/api/browser/open-file-store/open-file-store';
import type { FileTabResource } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import type { useWorkspace } from '@core/features/workbench/api/browser/task-composition-context';
import { relativeToWorkspace } from '@core/features/workspaces/api/browser/workspace-path';
import { getCoworkClient, type CoworkClient } from './client';

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected';
type Workspace = ReturnType<typeof useWorkspace>;
type Session = {
  path: string;
  id: string;
  client: CoworkClient;
  unsubscribe: () => void;
  doc: Y.Doc;
  binding: MonacoBinding;
  pending: Promise<void>;
  failed: boolean;
  connected: boolean;
  connectionId: string;
  socketPath: string;
  token: string;
  entry: NonNullable<FileTabResource['entry']>;
};

export interface CoworkEditor {
  status: Status;
  error: string | null;
  activePath: string | null;
  join: (socketPath: string, token: string) => Promise<void>;
  reconnect: () => Promise<void>;
  leave: () => void;
  save: (path?: string) => Promise<string | null>;
}

function decode(update: string): Uint8Array {
  return Uint8Array.from(atob(update), (character) => character.charCodeAt(0));
}

function encode(update: Uint8Array): string {
  let value = '';
  for (let offset = 0; offset < update.length; offset += 0x8000) {
    value += String.fromCharCode(...update.subarray(offset, offset + 0x8000));
  }
  return btoa(value);
}

export function useCoworkEditor(
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>,
  resource: FileTabResource | undefined,
  workspace: Workspace
): CoworkEditor {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const generationRef = useRef(0);

  const leave = useCallback(() => {
    generationRef.current += 1;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      session.unsubscribe();
      session.binding.destroy();
      session.doc.destroy();
      openFileStore.setCollaborative(session.entry, false);
      void session.client.leave({ sessionId: session.id });
    }
    setStatus('idle');
    setActivePath(null);
    setError(null);
  }, []);

  useEffect(
    () => () => leave(),
    [leave, resource?.path, workspace.path, workspace.sshConnectionId]
  );

  const join = useCallback(
    async (socketPath: string, token: string) => {
      if (!workspace.sshConnectionId || !resource?.entry || !resource.inWorkspace) return;
      if (resource.entry.collaborative) {
        setError('This file is already shared in another editor pane.');
        return;
      }
      if (resource.readOnly || resource.entry.dirty || resource.entry.conflicted) {
        setError('Save or resolve local changes before joining Cowork.');
        return;
      }
      const model = editorRef.current?.getModel();
      if (!model || !resource.ref) {
        setError('Wait for the text editor to finish loading.');
        return;
      }
      leave();
      const generation = generationRef.current;
      setStatus('connecting');
      let unsubscribe: (() => void) | undefined;
      let joinedSessionId: string | undefined;
      let client: CoworkClient | undefined;
      try {
        client = await getCoworkClient();
        const earlyUpdates: Array<{ sessionId: string; update: string }> = [];
        unsubscribe = await client.events.subscribe(undefined, {
          onEvent: (event) => {
            const session = sessionRef.current;
            if (event.type === 'disconnected' && session?.id === event.sessionId) {
              session.connected = false;
              setStatus('disconnected');
              setError('Cowork connection closed. Your local buffer is preserved.');
            }
            if (event.type !== 'update') return;
            if (!session) {
              earlyUpdates.push({ sessionId: event.sessionId, update: event.update });
            } else if (session.id === event.sessionId) {
              Y.applyUpdate(session.doc, decode(event.update), 'remote');
            }
          },
          onGap: () => {
            if (sessionRef.current) sessionRef.current.connected = false;
            setStatus('disconnected');
            setError('Cowork updates were missed. Reconnect to synchronize again.');
          },
        });
        if (generation !== generationRef.current) {
          unsubscribe();
          return;
        }
        const path = relativeToWorkspace(workspace.path, resource.path);
        const response = await client.join({
          connectionId: workspace.sshConnectionId,
          socketPath,
          token,
          path,
        });
        if (!response.success) throw new Error(response.error.message);
        joinedSessionId = response.data.sessionId;
        if (generation !== generationRef.current) {
          unsubscribe();
          void client.leave({ sessionId: response.data.sessionId });
          return;
        }
        if (resource.entry.dirty || editorRef.current?.getModel() !== model) {
          throw new Error('The local buffer changed while joining. Save it and try again.');
        }
        const doc = new Y.Doc();
        Y.applyUpdate(doc, decode(response.data.update), 'remote');
        for (const event of earlyUpdates) {
          if (event.sessionId === response.data.sessionId) {
            Y.applyUpdate(doc, decode(event.update), 'remote');
          }
        }
        const text = doc.getText('content');
        const binding = new MonacoBinding(text, model, new Set([editorRef.current]));
        const session: Session = {
          path: resource.path,
          id: response.data.sessionId,
          client,
          unsubscribe,
          doc,
          binding,
          pending: Promise.resolve(),
          failed: false,
          connected: true,
          connectionId: workspace.sshConnectionId,
          socketPath,
          token,
          entry: resource.entry,
        };
        sessionRef.current = session;
        joinedSessionId = undefined;
        openFileStore.setCollaborative(session.entry, true);
        doc.on('update', (update: Uint8Array, origin: unknown) => {
          if (origin === 'remote' || sessionRef.current !== session || !session.connected) return;
          const sessionId = session.id;
          session.pending = session.pending.then(async () => {
            if (!session.connected || session.id !== sessionId) return;
            try {
              const result = await session.client.sendUpdate({
                sessionId,
                update: encode(update),
              });
              if (!result.success) throw new Error(result.error.message);
            } catch (cause) {
              if (sessionRef.current !== session || session.id !== sessionId) return;
              session.failed = true;
              session.connected = false;
              setStatus('disconnected');
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          });
        });
        setActivePath(resource.path);
        setStatus('connected');
      } catch (cause) {
        unsubscribe?.();
        if (client && joinedSessionId) void client.leave({ sessionId: joinedSessionId });
        if (generation === generationRef.current) {
          setStatus('idle');
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    },
    [editorRef, leave, resource, workspace.path, workspace.sshConnectionId]
  );

  const reconnect = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || session.connected) return;
    const generation = generationRef.current;
    setStatus('connecting');
    let unsubscribe: (() => void) | undefined;
    let joinedSessionId: string | undefined;
    let client: CoworkClient | undefined;
    try {
      client = await getCoworkClient();
      const earlyUpdates: Array<{ sessionId: string; update: string }> = [];
      unsubscribe = await client.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type === 'disconnected' && event.sessionId === session.id) {
            session.connected = false;
            setStatus('disconnected');
            setError('Cowork connection closed. Your local buffer is preserved.');
          }
          if (event.type !== 'update') return;
          if (event.sessionId === session.id) {
            Y.applyUpdate(session.doc, decode(event.update), 'remote');
          } else {
            earlyUpdates.push({ sessionId: event.sessionId, update: event.update });
          }
        },
        onGap: () => {
          session.connected = false;
          setStatus('disconnected');
          setError('Cowork updates were missed. Reconnect to synchronize again.');
        },
      });
      if (generation !== generationRef.current) {
        unsubscribe();
        return;
      }
      const response = await client.join({
        connectionId: session.connectionId,
        socketPath: session.socketPath,
        token: session.token,
        path: relativeToWorkspace(workspace.path, session.path),
      });
      if (!response.success) throw new Error(response.error.message);
      joinedSessionId = response.data.sessionId;
      if (generation !== generationRef.current) {
        unsubscribe();
        void client.leave({ sessionId: response.data.sessionId });
        return;
      }
      session.unsubscribe();
      session.client = client;
      session.id = response.data.sessionId;
      session.unsubscribe = unsubscribe;
      Y.applyUpdate(session.doc, decode(response.data.update), 'remote');
      for (const event of earlyUpdates) {
        if (event.sessionId === session.id)
          Y.applyUpdate(session.doc, decode(event.update), 'remote');
      }
      session.failed = false;
      session.connected = true;
      session.pending = client
        .sendUpdate({
          sessionId: session.id,
          update: encode(Y.encodeStateAsUpdate(session.doc)),
        })
        .then((result) => {
          if (sessionRef.current !== session) return;
          if (!result.success) {
            session.failed = true;
            session.connected = false;
            setError(result.error.message);
          }
        })
        .catch((cause: unknown) => {
          if (sessionRef.current !== session) return;
          session.failed = true;
          session.connected = false;
          setError(cause instanceof Error ? cause.message : String(cause));
        });
      await session.pending;
      if (generation !== generationRef.current || sessionRef.current !== session) return;
      if (!session.connected)
        throw new Error('Could not synchronize local edits. Reconnect again.');
      setStatus('connected');
      setError(null);
    } catch (cause) {
      unsubscribe?.();
      if (client && joinedSessionId) void client.leave({ sessionId: joinedSessionId });
      if (generation !== generationRef.current || sessionRef.current !== session) return;
      session.connected = false;
      setStatus('disconnected');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [workspace.path]);

  const save = useCallback(async (path?: string): Promise<string | null> => {
    const session = sessionRef.current;
    if (!session || (path && session.path !== path)) return null;
    if (!session.connected || session.failed) {
      const message = 'Cowork is disconnected or an update failed; the shared file was not saved.';
      setError(message);
      toast.error('Cowork save failed', { description: message });
      return session.path;
    }
    await session.pending;
    if (sessionRef.current !== session) return session.path;
    if (!session.connected || session.failed) {
      const message = 'Cowork update failed; the shared file was not saved.';
      setError(message);
      toast.error('Cowork save failed', { description: message });
      return session.path;
    }
    try {
      const result = await session.client.save({ sessionId: session.id });
      if (sessionRef.current !== session) return session.path;
      if (result.success) {
        openFileStore.confirmCollaborativeSave(session.entry, result.data.content);
        setError(null);
      } else {
        const message =
          result.error.code === 'external-change'
            ? 'The file changed on disk. Shared edits are preserved; review the disk change before retrying.'
            : result.error.message;
        setError(message);
        toast.error('Cowork save failed', { description: message });
      }
    } catch (cause) {
      if (sessionRef.current === session) {
        session.connected = false;
        setStatus('disconnected');
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        toast.error('Cowork save failed', { description: message });
      }
    }
    return session.path;
  }, []);

  return { status, error, activePath, join, reconnect, leave, save };
}
