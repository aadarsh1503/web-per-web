import axios from 'axios';
import API_URL from './config';

const BASE = API_URL;

console.log('[API] Using BASE:', BASE);

const api = axios.create({ baseURL: BASE });

// Log every request
api.interceptors.request.use((config) => {
  console.log(`[API] ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
  return config;
});

// Log every response / error
api.interceptors.response.use(
  (res) => {
    console.log(`[API] ${res.status} ${res.config.url}`, res.data);
    return res;
  },
  (err) => {
    console.error(`[API] ERROR ${err.response?.status} ${err.config?.url}`, err.response?.data);
    return Promise.reject(err);
  }
);

export const getAccounts = () => api.get('/accounts');
export const addAccount = (data) => api.post('/accounts', data);
export const deleteAccount = (id) => api.delete(`/accounts/${id}`);
export const activateAccount = (id) => api.post(`/accounts/${id}/activate`);
export const switchAccount = (reason) => api.post('/accounts/switch', { reason });
export const updateAccount = (id, data) => api.patch(`/accounts/${id}`, data);
export const preparePhoneLogin = (id) => api.post(`/phone-login/prepare/${id}`);
