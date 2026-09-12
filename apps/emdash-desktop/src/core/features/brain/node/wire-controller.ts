import type { ContractImpl } from '@emdash/wire/rpc';
import { expose } from '@emdash/wire/state';
import { brainContract } from '../api';
import type { BrainService } from './brain-service';
import { brainEvents } from './event-host';

/** Thin delegate to BrainService; returns an owner so the caller disposes the providers. */
export function createBrainWireController(service: BrainService): {
  impl: ContractImpl<typeof brainContract>;
  dispose(): Promise<void>;
} {
  const { views } = service;
  const project = expose(brainContract.project, {
    jobs: (key: { projectId: string }) => views.project(key.projectId).jobs,
    done: (key: { projectId: string }) => views.project(key.projectId).done,
    notes: (key: { projectId: string }) => views.project(key.projectId).notes,
  });
  const lanePanel = expose(brainContract.lanePanel, {
    jobs: (key: { laneId: string }) => views.lanePanel(key.laneId).jobs,
    done: (key: { laneId: string }) => views.lanePanel(key.laneId).done,
    notes: (key: { laneId: string }) => views.lanePanel(key.laneId).notes,
  });
  const overview = expose(brainContract.overview, {
    unread: views.unread,
    sessions: views.sessions,
    dispatcher: views.dispatcher,
  });
  return {
    impl: {
      project,
      lanePanel,
      overview,
      events: brainEvents,
      createJob: (input) => service.createJob(input),
      linkJobs: ({ from, to }) => service.linkJobs(from, to),
      requeueJob: ({ jobId }) => service.requeueJob(jobId),
      sendMessage: (input) => service.sendMessage(input),
      readInbox: ({ address, includeRead }) => service.readInbox(address, includeRead),
      listDone: ({ projectId, limit }) => service.listDone(projectId, limit),
      listNotes: ({ projectId, limit }) => service.listNotes(projectId, limit),
      startBrain: ({ projectId }) => service.startBrain(projectId),
      stopBrain: ({ brainId }) => service.stopBrain(brainId),
      setDispatcherPaused: ({ paused }) => service.setDispatcherPaused(paused),
      setLaneMode: ({ laneId, mode }) => service.setLaneMode(laneId, mode),
      stopAll: () => service.stopAll(),
      clearStop: () => service.clearStop(),
    },
    async dispose() {
      await project.dispose();
      await lanePanel.dispose();
      await overview.dispose();
    },
  };
}
