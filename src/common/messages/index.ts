type MessageMap = Record<string, string>;

type ModuleMessagesOptions<S extends MessageMap, E extends MessageMap, W extends MessageMap> = {
  /** Singular display name, e.g. `Contact`. */
  entityName: string;
  /** Plural display name, e.g. `Contacts`. */
  entityNamePlural: string;
  customSuccess?: S;
  customError?: E;
  customWarning?: W;
};

type BaseSuccess = Record<'CREATED' | 'UPDATED' | 'DELETED' | 'FETCHED' | 'LISTED', string>;
type BaseError = Record<'NOT_FOUND' | 'ALREADY_EXISTS', string>;

export type ModuleMessages<S extends MessageMap, E extends MessageMap, W extends MessageMap> = {
  readonly SUCCESS: Readonly<BaseSuccess & S>;
  readonly ERROR: Readonly<BaseError & E>;
  readonly WARNING: Readonly<W>;
};

/**
 * Builds the message catalogue of a feature module.
 * Base CRUD messages are generated from the entity name; domain-specific ones are passed in
 * `custom*` and override a base message when they reuse its key.
 */
export function createModuleMessages<
  const S extends MessageMap = Record<never, never>,
  const E extends MessageMap = Record<never, never>,
  const W extends MessageMap = Record<never, never>,
>(options: ModuleMessagesOptions<S, E, W>): ModuleMessages<S, E, W> {
  const { entityName, entityNamePlural } = options;

  return {
    SUCCESS: {
      CREATED: `Tạo ${entityName} thành công`,
      UPDATED: `Cập nhật ${entityName} thành công`,
      DELETED: `Xóa ${entityName} thành công`,
      FETCHED: `Lấy thông tin ${entityName} thành công`,
      LISTED: `Lấy danh sách ${entityNamePlural} thành công`,
      ...options.customSuccess,
    } as BaseSuccess & S,
    ERROR: {
      NOT_FOUND: `${entityName} không tồn tại`,
      ALREADY_EXISTS: `${entityName} đã tồn tại`,
      ...options.customError,
    } as BaseError & E,
    WARNING: { ...options.customWarning } as W,
  };
}

/** Messages that do not belong to a feature module. */
export const COMMON_MESSAGES = {
  ERROR: {
    INTERNAL: 'Lỗi hệ thống, vui lòng thử lại sau',
    INVALID_ID: 'id không hợp lệ (phải là UUID)',
  },
} as const;
