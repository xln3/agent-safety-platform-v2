export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T | null;
}

export interface PaginatedData<T = any> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function successResponse<T = any>(data: T, message = 'success'): ApiResponse<T> {
  return { code: 0, message, data };
}

export function errorResponse(message: string, code = -1): ApiResponse<null> {
  return { code, message, data: null };
}

export function paginatedResponse<T = any>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
): ApiResponse<PaginatedData<T>> {
  return {
    code: 0,
    message: 'success',
    data: { list: data, total, page, pageSize },
  };
}
