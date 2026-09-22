export interface PaginationQuery {
  page?: number | string;
  limit?: number | string;
  search?: string;
  sort?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function getPagination(query: PaginationQuery, defaultLimit = 20) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip, search: query.search?.trim() ?? '', sort: query.sort ?? '-createdAt' };
}

export function buildPagination(total: number, page: number, limit: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export function paginatedResult<T>(items: T[], total: number, page: number, limit: number) {
  return {
    items,
    pagination: buildPagination(total, page, limit),
  };
}
