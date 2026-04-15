import axios from 'axios';
import { message } from 'antd';

const api = axios.create({
  baseURL: '',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => {
    const res = response.data;

    if (res && typeof res.code !== 'undefined') {
      if (res.code === 0) {
        return res.data;
      }
      const errMsg = res.message || '请求失败';
      message.error(errMsg);
      return Promise.reject(new Error(errMsg));
    }

    // If the response does not follow the envelope format, return as-is
    return res;
  },
  (error) => {
    if (error.response) {
      const status = error.response.status;
      const msg =
        error.response.data?.message ||
        (status === 401
          ? '未授权，请重新登录'
          : status === 403
            ? '无权限访问'
            : status === 404
              ? '请求的资源不存在'
              : status === 500
                ? '服务器内部错误'
                : `请求失败 (${status})`);
      message.error(msg);
    } else if (error.message?.includes('timeout')) {
      message.error('请求超时，请稍后重试');
    } else {
      message.error('网络异常，请检查连接');
    }
    return Promise.reject(error);
  },
);

export default api;
