import { ApiCreate, ApiDelete, ApiDetail, ApiList, ApiUpdate } from '@common/decorators/index.js';

import { TaskListItemDto, TaskResponseDto } from '../dto/index.js';

const RESOURCE = 'Task';

export const ApiTaskList = () => ApiList('Lấy danh sách task (phân trang)', TaskListItemDto);
export const ApiTaskDetail = () => ApiDetail('Lấy một task theo ID', TaskResponseDto, RESOURCE);
export const ApiTaskCreate = () => ApiCreate('Tạo task mới', TaskResponseDto);
export const ApiTaskUpdate = () => ApiUpdate('Cập nhật task', TaskResponseDto, RESOURCE);
export const ApiTaskDelete = () => ApiDelete('Xóa task', RESOURCE);
