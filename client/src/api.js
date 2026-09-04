import axios from 'axios';

// Use VITE_API_URL env var on production (Render backend URL)
// Falls back to relative /api for local dev with proxy
const BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({ baseURL: BASE });

export const getAccounts = () => api.get('/accounts');
export const addAccount = (data) => api.post('/accounts', data);
export const deleteAccount = (id) => api.delete(`/accounts/${id}`);
export const activateAccount = (id) => api.post(`/accounts/${id}/activate`);
export const switchAccount = (reason) => api.post('/accounts/switch', { reason });
export const updateAccount = (id, data) => api.patch(`/accounts/${id}`, data);
export const preparePhoneLogin = (id) => api.post(`/phone-login/prepare/${id}`);
