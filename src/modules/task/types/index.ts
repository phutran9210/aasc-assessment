import type { TaskStatus } from '../constants/index.js';

export type TaskResponse = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
};

/** List view: everything the brief asks for, without the audit `updatedAt`. */
export type TaskListItem = Omit<TaskResponse, 'updatedAt'>;
