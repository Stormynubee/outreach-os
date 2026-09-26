/**
 * Every piece of server state lives here, on top of @tanstack/react-query.
 * Query keys are centralised so invalidations (tasks + stats) can never drift apart.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeadQuery, PublicSettings, TaskRow, TaskStatus, TasksForDay } from '@outreach/shared';

import * as api from './api';
import type { CreateTaskRequest, UpdateLeadRequest, UpdateTaskRequest } from './api';

export const keys = {
  stats: ['stats'] as const,
  status: ['status'] as const,
  settings: ['settings'] as const,
  leadsRoot: ['leads'] as const,
  leads: (query: LeadQuery) => ['leads', query] as const,
  lead: (id: number) => ['lead', id] as const,
  tasksRoot: ['tasks'] as const,
  tasksForDay: (date: string) => ['tasks', date] as const,
  discoveries: ['discoveries'] as const,
  discovery: (id: number) => ['discovery', id] as const,
};

/* ------------------------------- reads ------------------------------- */

export function useStats() {
  return useQuery({ queryKey: keys.stats, queryFn: () => api.getStats() });
}

export function useStatus() {
  return useQuery({ queryKey: keys.status, queryFn: () => api.getStatus() });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.getSettings() });
}

export function useLeads(query: LeadQuery) {
  return useQuery({
    queryKey: keys.leads(query),
    queryFn: () => api.listLeads(query),
    placeholderData: keepPreviousData,
  });
}

export function useLead(id: number) {
  return useQuery({
    queryKey: keys.lead(id),
    queryFn: () => api.getLead(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useTasksForDay(date: string) {
  return useQuery({
    queryKey: keys.tasksForDay(date),
    queryFn: () => api.getTasksForDay(date),
  });
}

export function useDiscoveries() {
  return useQuery({ queryKey: keys.discoveries, queryFn: () => api.listDiscoveries() });
}

/**
 * Per-tile detail for one discovery run. The page works without it (SSE already reports
 * tile counters), so a 404/500 here is swallowed rather than surfaced as an error card.
 */
export function useDiscoveryProgress(id: number | null, pollMs: number | false) {
  return useQuery({
    queryKey: keys.discovery(id ?? -1),
    queryFn: () => api.getDiscovery(id ?? -1),
    enabled: id !== null && id > 0,
    retry: false,
    refetchInterval: pollMs,
  });
}

/* ------------------------------ mutations ---------------------------- */

/** Re-file a task into the right bucket after an optimistic status change. */
export function withTaskStatus(day: TasksForDay, id: number, status: TaskStatus): TasksForDay {
  const all: TaskRow[] = [...day.overdue, ...day.open, ...day.done, ...day.upcoming];
  const target = all.find((task) => task.id === id);
  if (!target) return day;

  const updated: TaskRow = { ...target, status, doneAt: status === 'done' ? (target.doneAt ?? Date.now()) : null };
  const without = (list: TaskRow[]): TaskRow[] => list.filter((task) => task.id !== id);

  return {
    ...day,
    overdue: without(day.overdue),
    open: status === 'open' || status === 'snoozed' ? [...without(day.open), updated] : without(day.open),
    done: status === 'done' ? [...without(day.done), updated] : without(day.done),
    upcoming: without(day.upcoming),
  };
}

/** Tick / untick a task. Updates the day list immediately, then re-syncs tasks + stats. */
export function useToggleTask(date: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: number; status: TaskStatus }) => api.updateTask(input.id, { status: input.status }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: keys.tasksForDay(date) });
      const previous = queryClient.getQueryData<TasksForDay>(keys.tasksForDay(date));
      if (previous) {
        queryClient.setQueryData(keys.tasksForDay(date), withTaskStatus(previous, input.id, input.status));
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(keys.tasksForDay(date), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tasksRoot });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateTaskRequest) => api.createTask(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tasksRoot });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useUpdateTask(date: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: number } & UpdateTaskRequest) => api.updateTask(input.id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tasksRoot });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
      void queryClient.invalidateQueries({ queryKey: keys.tasksForDay(date) });
    },
  });
}

export function useUpdateLead(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: UpdateLeadRequest) => api.updateLead(id, patch),
    onSuccess: (lead) => {
      queryClient.setQueryData(keys.lead(id), lead);
      void queryClient.invalidateQueries({ queryKey: keys.leadsRoot });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export function useSocialOverride(leadId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { socialId: number; manualOverride: number | null }) =>
      api.setSocialFollowerOverride(leadId, input.socialId, input.manualOverride),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.lead(leadId) });
      void queryClient.invalidateQueries({ queryKey: keys.leadsRoot });
    },
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (next: PublicSettings) => api.saveSettings(next),
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.settings, saved);
      void queryClient.invalidateQueries({ queryKey: keys.status });
    },
  });
}
